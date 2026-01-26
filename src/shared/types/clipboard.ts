/**
 * Atlas Desktop - Clipboard Types
 *
 * Type definitions for the clipboard history system.
 *
 * @module shared/types/clipboard
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Type of clipboard content
 */
export type ClipboardContentType = 'text' | 'image' | 'html' | 'rtf';

/**
 * Represents a single clipboard history entry
 */
export interface ClipboardEntry {
  /** Unique identifier */
  id: string;
  /** Type of content */
  type: ClipboardContentType;
  /** Text content (for text/html/rtf types) */
  text?: string;
  /** HTML content (if available) */
  html?: string;
  /** Image data as base64 (for image type) */
  imageBase64?: string;
  /** Image dimensions */
  imageSize?: { width: number; height: number };
  /** Preview text (truncated for display) */
  preview: string;
  /** Timestamp when copied */
  timestamp: number;
  /** Whether this item is pinned */
  pinned: boolean;
  /** Source application (if available) */
  sourceApp?: string;
  /** Hash of content for deduplication */
  contentHash: string;
  /** Content size in bytes */
  size: number;
  /** Whether content may be sensitive */
  isSensitive: boolean;
}

/**
 * Configuration for clipboard manager
 */
export interface ClipboardManagerConfig {
  /** Maximum number of history items (default: 100) */
  maxHistorySize: number;
  /** Maximum size of single item in bytes (default: 5MB) */
  maxItemSize: number;
  /** Enable sensitive content detection (default: true) */
  detectSensitiveContent: boolean;
  /** Auto-exclude sensitive content from history (default: true) */
  excludeSensitiveContent: boolean;
  /** Polling interval in ms (default: 500) */
  pollingInterval: number;
  /** Keyboard shortcut to show history (default: 'CommandOrControl+Shift+V') */
  shortcut: string;
  /** Enable image history (default: true) */
  enableImageHistory: boolean;
  /** Maximum image size in bytes to store (default: 2MB) */
  maxImageSize: number;
  /** Preview text length (default: 100) */
  previewLength: number;
}

/**
 * Statistics about clipboard history
 */
export interface ClipboardStats {
  /** Total number of entries */
  totalEntries: number;
  /** Number of pinned entries */
  pinnedEntries: number;
  /** Number of text entries */
  textEntries: number;
  /** Number of image entries */
  imageEntries: number;
  /** Total size of all entries in bytes */
  totalSize: number;
  /** Timestamp of oldest entry */
  oldestEntry: number | null;
  /** Timestamp of newest entry */
  newestEntry: number | null;
}

// ============================================================================
// IPC Types
// ============================================================================

/**
 * Options for getting clipboard history
 */
export interface GetHistoryOptions {
  /** Maximum number of items to return */
  limit?: number;
  /** Include pinned items */
  includePinned?: boolean;
  /** Filter by content type */
  type?: ClipboardContentType;
  /** Search query */
  search?: string;
}

/**
 * Result from getting clipboard history
 */
export interface GetHistoryResult {
  entries: ClipboardEntry[];
  stats: ClipboardStats;
}

/**
 * Result from clipboard operations
 */
export interface ClipboardOperationResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

// ============================================================================
// Voice Command Types
// ============================================================================

/**
 * Supported clipboard voice commands
 */
export type ClipboardVoiceCommand =
  | 'show_clipboard'
  | 'paste_item'
  | 'clear_clipboard'
  | 'pin_item'
  | 'search_clipboard';

/**
 * Clipboard voice command parameters
 */
export interface ClipboardVoiceCommandParams {
  /** Command type */
  command: ClipboardVoiceCommand;
  /** Item index (for paste_item, pin_item) */
  itemIndex?: number;
  /** Search query (for search_clipboard) */
  searchQuery?: string;
  /** Include pinned items (for clear_clipboard) */
  includePinned?: boolean;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Clipboard manager events
 */
export interface ClipboardManagerEvents {
  /** New entry added to history */
  'entry-added': ClipboardEntry;
  /** Entry removed from history */
  'entry-removed': string;
  /** Entry pin status changed */
  'entry-pinned': { id: string; pinned: boolean };
  /** History was cleared */
  'history-cleared': void;
  /** Clipboard content changed */
  'clipboard-changed': ClipboardEntry | null;
  /** Sensitive content was detected */
  'sensitive-detected': ClipboardEntry;
  /** Error occurred */
  error: Error;
}

// ============================================================================
// Sensitive Content Types
// ============================================================================

/**
 * Types of sensitive content that can be detected
 */
export type SensitiveContentType =
  | 'credit_card'
  | 'ssn'
  | 'api_key'
  | 'private_key'
  | 'aws_credential'
  | 'jwt_token'
  | 'github_token'
  | 'password'
  | 'connection_string'
  | 'unknown';

/**
 * Result from sensitive content detection
 */
export interface SensitiveContentResult {
  /** Whether sensitive content was detected */
  isSensitive: boolean;
  /** Types of sensitive content found */
  types: SensitiveContentType[];
  /** Confidence level (0-1) */
  confidence: number;
}
