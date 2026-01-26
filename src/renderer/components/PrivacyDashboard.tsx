/**
 * Atlas Desktop - Privacy Dashboard Component
 * User-facing privacy controls for data management, consent, and GDPR compliance
 */

import React, { useCallback, useEffect, useState } from 'react';
import { LoadingIndicator } from './common';
import './PrivacyDashboard.css';

/**
 * Privacy settings state
 */
interface PrivacySettings {
  /** Enable local-only mode (no cloud services) */
  localOnlyMode: boolean;
  /** Anonymize user data before processing */
  anonymizeData: boolean;
  /** Enable conversation logging */
  enableConversationLogging: boolean;
  /** Enable voice recording storage */
  storeVoiceRecordings: boolean;
  /** Enable analytics collection */
  enableAnalytics: boolean;
  /** Data retention period in days (0 = indefinite) */
  dataRetentionDays: number;
  /** Enable telemetry */
  enableTelemetry: boolean;
}

/**
 * Consent status for various data uses
 */
interface ConsentStatus {
  /** Consent for voice processing */
  voiceProcessing: boolean;
  /** Consent for LLM processing */
  llmProcessing: boolean;
  /** Consent for memory storage */
  memoryStorage: boolean;
  /** Consent for analytics */
  analytics: boolean;
  /** Timestamp of last consent update */
  lastUpdated: number;
}

/**
 * Data statistics for privacy dashboard
 */
interface DataStats {
  /** Total conversations stored */
  conversationCount: number;
  /** Total memory entries */
  memoryEntryCount: number;
  /** Total voice recordings (if stored) */
  voiceRecordingCount: number;
  /** Total data size in bytes */
  totalDataSizeBytes: number;
  /** Oldest data timestamp */
  oldestDataTimestamp: number | null;
  /** Data by type */
  dataByType: {
    conversations: number;
    memories: number;
    preferences: number;
    voiceData: number;
  };
}

/**
 * Activity log entry
 */
interface ActivityLogEntry {
  id: string;
  timestamp: number;
  type: 'voice' | 'llm' | 'memory' | 'file' | 'browser' | 'system';
  action: string;
  details?: string;
  dataAccessed?: string[];
}

/**
 * Privacy Dashboard props
 */
interface PrivacyDashboardProps {
  /** Whether the dashboard is open */
  isOpen: boolean;
  /** Close callback */
  onClose: () => void;
}

/**
 * Section component for organizing content
 */
interface SectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, description, children }) => (
  <div className="privacy-section">
    <h3 className="privacy-section-title">{title}</h3>
    {description && <p className="privacy-section-description">{description}</p>}
    <div className="privacy-section-content">{children}</div>
  </div>
);

/**
 * Toggle component for privacy settings
 */
interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  warning?: boolean;
}

const Toggle: React.FC<ToggleProps> = ({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  warning = false,
}) => (
  <div className={`privacy-toggle ${disabled ? 'disabled' : ''}`}>
    <div className="privacy-toggle-info">
      <label className="privacy-toggle-label">{label}</label>
      {description && <span className="privacy-toggle-description">{description}</span>}
    </div>
    <button
      type="button"
      className={`toggle-switch ${checked ? 'active' : ''} ${warning ? 'warning' : ''}`}
      onClick={() => !disabled && onChange(!checked)}
      aria-pressed={checked}
      disabled={disabled}
    >
      <span className="toggle-slider" />
    </button>
  </div>
);

/**
 * Data card component for displaying data categories
 */
interface DataCardProps {
  title: string;
  count: number;
  size?: string;
  icon: React.ReactNode;
  onDelete?: () => void;
  deleteLabel?: string;
}

const DataCard: React.FC<DataCardProps> = ({
  title,
  count,
  size,
  icon,
  onDelete,
  deleteLabel = 'Delete',
}) => (
  <div className="data-card">
    <div className="data-card-icon">{icon}</div>
    <div className="data-card-info">
      <h4 className="data-card-title">{title}</h4>
      <p className="data-card-count">{count.toLocaleString()} items</p>
      {size && <p className="data-card-size">{size}</p>}
    </div>
    {onDelete && (
      <button className="data-card-delete" onClick={onDelete} title={deleteLabel}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
    )}
  </div>
);

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Format timestamp to human-readable date
 */
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Privacy Dashboard Component
 */
export const PrivacyDashboard: React.FC<PrivacyDashboardProps> = ({ isOpen, onClose }) => {
  // State
  const [activeTab, setActiveTab] = useState<
    'overview' | 'settings' | 'consent' | 'activity' | 'policy'
  >('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Data states
  const [dataStats, setDataStats] = useState<DataStats | null>(null);
  const [privacySettings, setPrivacySettings] = useState<PrivacySettings>({
    localOnlyMode: false,
    anonymizeData: false,
    enableConversationLogging: true,
    storeVoiceRecordings: false,
    enableAnalytics: true,
    dataRetentionDays: 90,
    enableTelemetry: true,
  });
  const [consentStatus, setConsentStatus] = useState<ConsentStatus>({
    voiceProcessing: true,
    llmProcessing: true,
    memoryStorage: true,
    analytics: true,
    lastUpdated: Date.now(),
  });
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [activityFilter, setActivityFilter] = useState<string>('all');

  // Load data on mount
  useEffect(() => {
    if (isOpen) {
      loadPrivacyData();
    }
  }, [isOpen]);

  // Load privacy data from main process
  const loadPrivacyData = async () => {
    setIsLoading(true);
    try {
      // Fetch data stats
      const statsResult = await window.atlas?.privacy?.getDataStats();
      if (statsResult?.success && statsResult.data) {
        setDataStats(statsResult.data as DataStats);
      } else {
        // Mock data for development
        setDataStats({
          conversationCount: 47,
          memoryEntryCount: 156,
          voiceRecordingCount: 0,
          totalDataSizeBytes: 2457600,
          oldestDataTimestamp: Date.now() - 30 * 24 * 60 * 60 * 1000,
          dataByType: {
            conversations: 1228800,
            memories: 921600,
            preferences: 102400,
            voiceData: 204800,
          },
        });
      }

      // Fetch privacy settings
      const settingsResult = await window.atlas?.privacy?.getSettings();
      if (settingsResult?.success && settingsResult.data) {
        setPrivacySettings(settingsResult.data as PrivacySettings);
      }

      // Fetch consent status
      const consentResult = await window.atlas?.privacy?.getConsentStatus();
      if (consentResult?.success && consentResult.data) {
        setConsentStatus(consentResult.data as ConsentStatus);
      }

      // Fetch activity log
      const logResult = await window.atlas?.privacy?.getActivityLog({ limit: 100 });
      if (logResult?.success && logResult.data) {
        setActivityLog(logResult.data as ActivityLogEntry[]);
      } else {
        // Mock activity log for development
        setActivityLog([
          {
            id: '1',
            timestamp: Date.now() - 5 * 60 * 1000,
            type: 'voice',
            action: 'Voice command processed',
            details: 'Query: "What is the weather today?"',
          },
          {
            id: '2',
            timestamp: Date.now() - 15 * 60 * 1000,
            type: 'llm',
            action: 'LLM response generated',
            details: 'Used Fireworks AI provider',
          },
          {
            id: '3',
            timestamp: Date.now() - 30 * 60 * 1000,
            type: 'memory',
            action: 'Conversation saved to memory',
            details: 'Session ID: abc123',
          },
          {
            id: '4',
            timestamp: Date.now() - 60 * 60 * 1000,
            type: 'file',
            action: 'File access requested',
            details: 'Read: ~/Documents/notes.txt',
          },
          {
            id: '5',
            timestamp: Date.now() - 2 * 60 * 60 * 1000,
            type: 'system',
            action: 'Privacy settings updated',
            details: 'Local-only mode: disabled',
          },
        ]);
      }
    } catch (error) {
      console.error('[PrivacyDashboard] Failed to load privacy data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Update privacy settings
  const updateSettings = useCallback(
    async (key: keyof PrivacySettings, value: boolean | number) => {
      const newSettings = { ...privacySettings, [key]: value };
      setPrivacySettings(newSettings);
      setIsSaving(true);
      try {
        await window.atlas?.privacy?.updateSettings(newSettings);
      } catch (error) {
        console.error('[PrivacyDashboard] Failed to update settings:', error);
      } finally {
        setIsSaving(false);
      }
    },
    [privacySettings]
  );

  // Update consent
  const updateConsent = useCallback(
    async (key: keyof Omit<ConsentStatus, 'lastUpdated'>, value: boolean) => {
      const newConsent = { ...consentStatus, [key]: value, lastUpdated: Date.now() };
      setConsentStatus(newConsent);
      setIsSaving(true);
      try {
        await window.atlas?.privacy?.updateConsent(newConsent);
      } catch (error) {
        console.error('[PrivacyDashboard] Failed to update consent:', error);
      } finally {
        setIsSaving(false);
      }
    },
    [consentStatus]
  );

  // Export personal data (GDPR)
  const exportData = async () => {
    setIsExporting(true);
    try {
      const result = await window.atlas?.privacy?.exportData();
      if (result?.success) {
        // Show success message or download file
        alert(`Data exported successfully to: ${result.data?.path || 'your downloads folder'}`);
      } else {
        throw new Error(result?.error || 'Export failed');
      }
    } catch (error) {
      console.error('[PrivacyDashboard] Failed to export data:', error);
      alert('Failed to export data. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  // Delete all data
  const deleteAllData = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to delete ALL your data? This action cannot be undone.\n\n' +
        'This will delete:\n' +
        '- All conversation history\n' +
        '- All saved memories\n' +
        '- All preferences and settings\n' +
        '- All voice recordings (if any)'
    );

    if (!confirmed) return;

    // Second confirmation for safety
    const doubleConfirmed = window.confirm(
      'This is your final warning. ALL data will be permanently deleted.\n\n' +
        'Type "DELETE" in the next prompt to confirm.'
    );

    if (!doubleConfirmed) return;

    const userInput = window.prompt('Type DELETE to confirm permanent data deletion:');
    if (userInput !== 'DELETE') {
      alert('Deletion cancelled. You must type DELETE exactly.');
      return;
    }

    setIsDeleting(true);
    try {
      const result = await window.atlas?.privacy?.deleteAllData();
      if (result?.success) {
        alert('All data has been deleted successfully.');
        await loadPrivacyData();
      } else {
        throw new Error(result?.error || 'Deletion failed');
      }
    } catch (error) {
      console.error('[PrivacyDashboard] Failed to delete data:', error);
      alert('Failed to delete data. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  // Delete specific data category
  const deleteDataCategory = async (
    category: 'conversations' | 'memories' | 'voiceData' | 'preferences'
  ) => {
    const categoryNames = {
      conversations: 'conversation history',
      memories: 'saved memories',
      voiceData: 'voice recordings',
      preferences: 'preferences',
    };

    const confirmed = window.confirm(
      `Are you sure you want to delete all ${categoryNames[category]}?\n\n` +
        'This action cannot be undone.'
    );

    if (!confirmed) return;

    setIsDeleting(true);
    try {
      const result = await window.atlas?.privacy?.deleteCategory(category);
      if (result?.success) {
        alert(
          `${categoryNames[category].charAt(0).toUpperCase() + categoryNames[category].slice(1)} deleted successfully.`
        );
        await loadPrivacyData();
      } else {
        throw new Error(result?.error || 'Deletion failed');
      }
    } catch (error) {
      console.error(`[PrivacyDashboard] Failed to delete ${category}:`, error);
      alert(`Failed to delete ${categoryNames[category]}. Please try again.`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle close with escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Filter activity log
  const filteredActivityLog =
    activityFilter === 'all'
      ? activityLog
      : activityLog.filter((entry) => entry.type === activityFilter);

  if (!isOpen) return null;

  return (
    <div className="privacy-overlay" onClick={onClose}>
      <div className="privacy-dashboard" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="privacy-header">
          <div className="privacy-header-content">
            <div className="privacy-header-icon">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <div>
              <h2 className="privacy-title">Privacy Dashboard</h2>
              <p className="privacy-subtitle">Manage your data and privacy preferences</p>
            </div>
          </div>
          <button className="privacy-close" onClick={onClose} aria-label="Close privacy dashboard">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="privacy-tabs">
          <button
            className={`privacy-tab ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button
            className={`privacy-tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </button>
          <button
            className={`privacy-tab ${activeTab === 'consent' ? 'active' : ''}`}
            onClick={() => setActiveTab('consent')}
          >
            Consent
          </button>
          <button
            className={`privacy-tab ${activeTab === 'activity' ? 'active' : ''}`}
            onClick={() => setActiveTab('activity')}
          >
            Activity Log
          </button>
          <button
            className={`privacy-tab ${activeTab === 'policy' ? 'active' : ''}`}
            onClick={() => setActiveTab('policy')}
          >
            Privacy Policy
          </button>
        </div>

        {/* Content */}
        <div className="privacy-content">
          {isLoading ? (
            <div className="privacy-loading">
              <LoadingIndicator size="large" variant="spinner" text="Loading privacy data..." />
            </div>
          ) : (
            <>
              {/* Overview Tab */}
              {activeTab === 'overview' && (
                <div className="privacy-overview">
                  {/* Quick Stats */}
                  <Section title="Your Data at a Glance">
                    <div className="data-stats-grid">
                      <div className="data-stat">
                        <span className="data-stat-value">
                          {dataStats ? formatBytes(dataStats.totalDataSizeBytes) : '--'}
                        </span>
                        <span className="data-stat-label">Total Data Stored</span>
                      </div>
                      <div className="data-stat">
                        <span className="data-stat-value">
                          {dataStats?.conversationCount.toLocaleString() || '--'}
                        </span>
                        <span className="data-stat-label">Conversations</span>
                      </div>
                      <div className="data-stat">
                        <span className="data-stat-value">
                          {dataStats?.memoryEntryCount.toLocaleString() || '--'}
                        </span>
                        <span className="data-stat-label">Memory Entries</span>
                      </div>
                      <div className="data-stat">
                        <span className="data-stat-value">
                          {dataStats?.oldestDataTimestamp
                            ? Math.floor(
                                (Date.now() - dataStats.oldestDataTimestamp) / (24 * 60 * 60 * 1000)
                              )
                            : '--'}
                        </span>
                        <span className="data-stat-label">Days of History</span>
                      </div>
                    </div>
                  </Section>

                  {/* Data Categories */}
                  <Section
                    title="Data by Category"
                    description="Click the delete button to remove specific data categories."
                  >
                    <div className="data-cards-grid">
                      <DataCard
                        title="Conversations"
                        count={dataStats?.conversationCount || 0}
                        size={
                          dataStats ? formatBytes(dataStats.dataByType.conversations) : undefined
                        }
                        icon={
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                          </svg>
                        }
                        onDelete={() => deleteDataCategory('conversations')}
                        deleteLabel="Delete all conversations"
                      />
                      <DataCard
                        title="Memories"
                        count={dataStats?.memoryEntryCount || 0}
                        size={dataStats ? formatBytes(dataStats.dataByType.memories) : undefined}
                        icon={
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                          </svg>
                        }
                        onDelete={() => deleteDataCategory('memories')}
                        deleteLabel="Delete all memories"
                      />
                      <DataCard
                        title="Voice Data"
                        count={dataStats?.voiceRecordingCount || 0}
                        size={dataStats ? formatBytes(dataStats.dataByType.voiceData) : undefined}
                        icon={
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" y1="19" x2="12" y2="23" />
                            <line x1="8" y1="23" x2="16" y2="23" />
                          </svg>
                        }
                        onDelete={() => deleteDataCategory('voiceData')}
                        deleteLabel="Delete all voice data"
                      />
                      <DataCard
                        title="Preferences"
                        count={1}
                        size={dataStats ? formatBytes(dataStats.dataByType.preferences) : undefined}
                        icon={
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <circle cx="12" cy="12" r="3" />
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                          </svg>
                        }
                        onDelete={() => deleteDataCategory('preferences')}
                        deleteLabel="Reset preferences"
                      />
                    </div>
                  </Section>

                  {/* Quick Actions */}
                  <Section title="Data Management Actions">
                    <div className="quick-actions">
                      <button
                        className="action-button export"
                        onClick={exportData}
                        disabled={isExporting}
                      >
                        {isExporting ? (
                          <>
                            <LoadingIndicator size="small" variant="spinner" inline />
                            <span>Exporting...</span>
                          </>
                        ) : (
                          <>
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="18"
                              height="18"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            <span>Export My Data (GDPR)</span>
                          </>
                        )}
                      </button>
                      <button
                        className="action-button danger"
                        onClick={deleteAllData}
                        disabled={isDeleting}
                      >
                        {isDeleting ? (
                          <>
                            <LoadingIndicator size="small" variant="spinner" inline />
                            <span>Deleting...</span>
                          </>
                        ) : (
                          <>
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="18"
                              height="18"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <line x1="10" y1="11" x2="10" y2="17" />
                              <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                            <span>Forget Everything</span>
                          </>
                        )}
                      </button>
                    </div>
                  </Section>
                </div>
              )}

              {/* Settings Tab */}
              {activeTab === 'settings' && (
                <div className="privacy-settings">
                  <Section
                    title="Data Processing"
                    description="Control how Atlas processes and stores your data."
                  >
                    <Toggle
                      label="Local-Only Mode"
                      description="Process all data locally without sending to cloud services. May reduce functionality."
                      checked={privacySettings.localOnlyMode}
                      onChange={(v) => updateSettings('localOnlyMode', v)}
                      warning={true}
                    />
                    <Toggle
                      label="Anonymize Data"
                      description="Remove personally identifiable information before processing."
                      checked={privacySettings.anonymizeData}
                      onChange={(v) => updateSettings('anonymizeData', v)}
                    />
                    <Toggle
                      label="Conversation Logging"
                      description="Save conversation history for context and memory features."
                      checked={privacySettings.enableConversationLogging}
                      onChange={(v) => updateSettings('enableConversationLogging', v)}
                    />
                    <Toggle
                      label="Store Voice Recordings"
                      description="Keep voice recordings for improved recognition (not recommended)."
                      checked={privacySettings.storeVoiceRecordings}
                      onChange={(v) => updateSettings('storeVoiceRecordings', v)}
                      warning={true}
                    />
                  </Section>

                  <Section
                    title="Analytics & Telemetry"
                    description="Help improve Atlas by sharing anonymous usage data."
                  >
                    <Toggle
                      label="Usage Analytics"
                      description="Share anonymous usage statistics to improve features."
                      checked={privacySettings.enableAnalytics}
                      onChange={(v) => updateSettings('enableAnalytics', v)}
                    />
                    <Toggle
                      label="Error Telemetry"
                      description="Automatically report errors to help fix bugs faster."
                      checked={privacySettings.enableTelemetry}
                      onChange={(v) => updateSettings('enableTelemetry', v)}
                    />
                  </Section>

                  <Section
                    title="Data Retention"
                    description="Configure how long your data is stored."
                  >
                    <div className="retention-setting">
                      <label className="retention-label">Retention Period</label>
                      <select
                        className="retention-select"
                        value={privacySettings.dataRetentionDays}
                        onChange={(e) =>
                          updateSettings('dataRetentionDays', parseInt(e.target.value))
                        }
                      >
                        <option value={7}>7 days</option>
                        <option value={30}>30 days</option>
                        <option value={90}>90 days</option>
                        <option value={180}>180 days</option>
                        <option value={365}>1 year</option>
                        <option value={0}>Indefinite</option>
                      </select>
                      <p className="retention-description">
                        Data older than this will be automatically deleted.
                      </p>
                    </div>
                  </Section>

                  {isSaving && (
                    <div className="saving-indicator">
                      <LoadingIndicator size="small" variant="dots" inline text="Saving..." />
                    </div>
                  )}
                </div>
              )}

              {/* Consent Tab */}
              {activeTab === 'consent' && (
                <div className="privacy-consent">
                  <Section
                    title="Consent Management"
                    description="Control what Atlas is allowed to do with your data. Withdrawing consent may affect functionality."
                  >
                    <div className="consent-info">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="16" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                      <span>Last updated: {formatDate(consentStatus.lastUpdated)}</span>
                    </div>

                    <div className="consent-list">
                      <div className="consent-item">
                        <div className="consent-item-header">
                          <Toggle
                            label="Voice Processing"
                            checked={consentStatus.voiceProcessing}
                            onChange={(v) => updateConsent('voiceProcessing', v)}
                          />
                        </div>
                        <p className="consent-item-description">
                          Allow Atlas to process your voice input for speech-to-text conversion.
                          Required for voice commands.
                        </p>
                      </div>

                      <div className="consent-item">
                        <div className="consent-item-header">
                          <Toggle
                            label="LLM Processing"
                            checked={consentStatus.llmProcessing}
                            onChange={(v) => updateConsent('llmProcessing', v)}
                          />
                        </div>
                        <p className="consent-item-description">
                          Allow Atlas to send your queries to language model providers for
                          generating responses. Required for AI responses.
                        </p>
                      </div>

                      <div className="consent-item">
                        <div className="consent-item-header">
                          <Toggle
                            label="Memory Storage"
                            checked={consentStatus.memoryStorage}
                            onChange={(v) => updateConsent('memoryStorage', v)}
                          />
                        </div>
                        <p className="consent-item-description">
                          Allow Atlas to store conversation history and learned preferences. Enables
                          contextual awareness.
                        </p>
                      </div>

                      <div className="consent-item">
                        <div className="consent-item-header">
                          <Toggle
                            label="Analytics Collection"
                            checked={consentStatus.analytics}
                            onChange={(v) => updateConsent('analytics', v)}
                          />
                        </div>
                        <p className="consent-item-description">
                          Allow collection of anonymous usage data to improve Atlas. No personal
                          data is collected.
                        </p>
                      </div>
                    </div>
                  </Section>
                </div>
              )}

              {/* Activity Log Tab */}
              {activeTab === 'activity' && (
                <div className="privacy-activity">
                  <Section
                    title="Activity Log"
                    description="View recent data access and processing activities."
                  >
                    <div className="activity-filter">
                      <label className="filter-label">Filter by type:</label>
                      <select
                        className="filter-select"
                        value={activityFilter}
                        onChange={(e) => setActivityFilter(e.target.value)}
                      >
                        <option value="all">All Activities</option>
                        <option value="voice">Voice Processing</option>
                        <option value="llm">LLM Queries</option>
                        <option value="memory">Memory Access</option>
                        <option value="file">File Access</option>
                        <option value="browser">Browser Actions</option>
                        <option value="system">System Events</option>
                      </select>
                    </div>

                    <div className="activity-list">
                      {filteredActivityLog.length === 0 ? (
                        <div className="activity-empty">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="48"
                            height="48"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1"
                          >
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                            <polyline points="10 9 9 9 8 9" />
                          </svg>
                          <p>No activities found for the selected filter.</p>
                        </div>
                      ) : (
                        filteredActivityLog.map((entry) => (
                          <div key={entry.id} className={`activity-item activity-${entry.type}`}>
                            <div className="activity-icon">
                              {entry.type === 'voice' && (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                </svg>
                              )}
                              {entry.type === 'llm' && (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <rect x="3" y="3" width="18" height="18" rx="2" />
                                  <path d="M3 9h18M9 21V9" />
                                </svg>
                              )}
                              {entry.type === 'memory' && (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                                </svg>
                              )}
                              {entry.type === 'file' && (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                  <polyline points="14 2 14 8 20 8" />
                                </svg>
                              )}
                              {entry.type === 'browser' && (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <circle cx="12" cy="12" r="10" />
                                  <line x1="2" y1="12" x2="22" y2="12" />
                                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                                </svg>
                              )}
                              {entry.type === 'system' && (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <circle cx="12" cy="12" r="3" />
                                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                                </svg>
                              )}
                            </div>
                            <div className="activity-content">
                              <div className="activity-header">
                                <span className="activity-action">{entry.action}</span>
                                <span className="activity-time">{formatDate(entry.timestamp)}</span>
                              </div>
                              {entry.details && <p className="activity-details">{entry.details}</p>}
                              {entry.dataAccessed && entry.dataAccessed.length > 0 && (
                                <div className="activity-data">
                                  <span className="data-label">Data accessed:</span>
                                  <span className="data-list">{entry.dataAccessed.join(', ')}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </Section>
                </div>
              )}

              {/* Privacy Policy Tab */}
              {activeTab === 'policy' && (
                <div className="privacy-policy">
                  <Section title="Privacy Policy">
                    <div className="policy-content">
                      <h4>1. Introduction</h4>
                      <p>
                        Atlas Desktop is committed to protecting your privacy. This policy explains
                        how we collect, use, and safeguard your personal information when you use
                        our voice assistant application.
                      </p>

                      <h4>2. Data Collection</h4>
                      <p>Atlas may collect the following types of data:</p>
                      <ul>
                        <li>
                          <strong>Voice Data:</strong> Audio input processed for speech recognition.
                          By default, voice recordings are not stored.
                        </li>
                        <li>
                          <strong>Conversation History:</strong> Text transcripts of your
                          interactions with Atlas for contextual awareness.
                        </li>
                        <li>
                          <strong>Preferences:</strong> Your settings and customization choices.
                        </li>
                        <li>
                          <strong>Usage Analytics:</strong> Anonymous data about how you use Atlas
                          (if enabled).
                        </li>
                      </ul>

                      <h4>3. Data Processing</h4>
                      <p>
                        Your data may be processed by third-party services for speech recognition,
                        language processing, and text-to-speech synthesis. We use industry-leading
                        providers that maintain strict privacy standards. You can enable
                        &quot;Local-Only Mode&quot; to process data entirely on your device.
                      </p>

                      <h4>4. Data Storage</h4>
                      <p>
                        Data is stored locally on your device in the Atlas application data
                        directory. Cloud synchronization is optional and disabled by default. You
                        can configure data retention periods or delete your data at any time.
                      </p>

                      <h4>5. Your Rights (GDPR)</h4>
                      <p>Under GDPR, you have the right to:</p>
                      <ul>
                        <li>
                          <strong>Access:</strong> Request a copy of all your personal data.
                        </li>
                        <li>
                          <strong>Rectification:</strong> Correct inaccurate personal data.
                        </li>
                        <li>
                          <strong>Erasure:</strong> Request deletion of your personal data
                          (&quot;right to be forgotten&quot;).
                        </li>
                        <li>
                          <strong>Portability:</strong> Receive your data in a machine-readable
                          format.
                        </li>
                        <li>
                          <strong>Objection:</strong> Object to processing of your personal data.
                        </li>
                        <li>
                          <strong>Withdraw Consent:</strong> Withdraw consent at any time.
                        </li>
                      </ul>

                      <h4>6. Data Security</h4>
                      <p>
                        We implement appropriate security measures to protect your data, including
                        encryption at rest and in transit, secure API key storage, and regular
                        security audits.
                      </p>

                      <h4>7. Third-Party Services</h4>
                      <p>Atlas may use the following third-party services:</p>
                      <ul>
                        <li>Deepgram (Speech-to-Text)</li>
                        <li>ElevenLabs (Text-to-Speech)</li>
                        <li>Fireworks AI / OpenRouter (Language Models)</li>
                        <li>Picovoice (Wake Word Detection)</li>
                      </ul>
                      <p>
                        Each service has its own privacy policy which governs their use of your
                        data.
                      </p>

                      <h4>8. Children&apos;s Privacy</h4>
                      <p>
                        Atlas is not intended for use by children under 13. We do not knowingly
                        collect personal information from children.
                      </p>

                      <h4>9. Changes to This Policy</h4>
                      <p>
                        We may update this privacy policy from time to time. We will notify you of
                        any significant changes through the application.
                      </p>

                      <h4>10. Contact</h4>
                      <p>
                        For privacy-related inquiries or to exercise your rights, please contact us
                        through the application settings or visit our website.
                      </p>

                      <div className="policy-footer">
                        <p className="policy-date">Last updated: January 2026</p>
                      </div>
                    </div>
                  </Section>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="privacy-footer">
          <div className="privacy-footer-info">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <polyline points="9 12 12 15 15 10" />
            </svg>
            <span>Your privacy is important to us</span>
          </div>
          <button className="privacy-done-button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default PrivacyDashboard;
