/**
 * Atlas Desktop - Data Anonymization Module
 * Comprehensive PII detection and anonymization for privacy protection
 *
 * Features:
 * - Detect and mask PII in transcripts (names, emails, phones, SSN, credit cards)
 * - Anonymize data before sending to external APIs
 * - Configurable anonymization levels (minimal, standard, aggressive, paranoid)
 * - Reversible anonymization for local storage
 * - Pattern-based detection (regex)
 * - Entity recognition for names using common name patterns
 * - Audit log of anonymization actions
 *
 * @module security/anonymizer
 */

import { randomUUID, createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getAuditLogger } from './audit-logger';
import { count } from '../../shared/utils';

const logger = createModuleLogger('Anonymizer');

// ============================================================
// Types and Interfaces
// ============================================================

/**
 * Types of personally identifiable information (PII)
 */
export type PIIType =
  | 'email'
  | 'phone'
  | 'ssn'
  | 'credit_card'
  | 'ip_address'
  | 'date_of_birth'
  | 'name'
  | 'address'
  | 'url'
  | 'api_key'
  | 'password'
  | 'username'
  | 'custom';

/**
 * Anonymization levels
 * - minimal: Only mask high-risk data (SSN, credit cards, passwords)
 * - standard: Mask most PII but preserve some context
 * - aggressive: Mask all detected PII
 * - paranoid: Mask everything including potential false positives
 */
export type AnonymizationLevel = 'minimal' | 'standard' | 'aggressive' | 'paranoid';

/**
 * Detected PII instance
 */
export interface DetectedPII {
  /** Type of PII detected */
  type: PIIType;
  /** Original value that was detected */
  value: string;
  /** Start position in the original text */
  startIndex: number;
  /** End position in the original text */
  endIndex: number;
  /** Confidence score (0-1) */
  confidence: number;
  /** Pattern that matched (for debugging) */
  matchedPattern?: string;
  /** Whether this is a high-risk PII type */
  highRisk: boolean;
}

/**
 * Anonymization token for reversible anonymization
 */
export interface AnonymizationToken {
  /** Unique token ID */
  id: string;
  /** Original value (encrypted) */
  encryptedValue: string;
  /** Initialization vector for decryption */
  iv: string;
  /** Type of PII */
  type: PIIType;
  /** Placeholder used in anonymized text */
  placeholder: string;
  /** Timestamp of anonymization */
  timestamp: string;
  /** Session ID if applicable */
  sessionId?: string;
  /** Hash of original value for dedup */
  valueHash: string;
}

/**
 * Anonymization result
 */
export interface AnonymizationResult {
  /** Original text */
  original: string;
  /** Anonymized text */
  anonymized: string;
  /** Detected PII items */
  detectedPII: DetectedPII[];
  /** Tokens for reversal (if reversible) */
  tokens: AnonymizationToken[];
  /** Anonymization level used */
  level: AnonymizationLevel;
  /** Processing time in milliseconds */
  processingTimeMs: number;
  /** Whether anonymization was performed */
  wasAnonymized: boolean;
}

/**
 * Deanonymization result
 */
export interface DeanonymizationResult {
  /** Original anonymized text */
  anonymized: string;
  /** Restored text */
  restored: string;
  /** Tokens that were used */
  tokensUsed: number;
  /** Tokens that failed to restore */
  tokensFailed: number;
  /** Whether restoration was successful */
  success: boolean;
}

/**
 * Anonymizer configuration
 */
export interface AnonymizerConfig {
  /** Default anonymization level */
  defaultLevel: AnonymizationLevel;
  /** Enable reversible anonymization */
  enableReversible: boolean;
  /** Encryption key for reversible tokens (32 bytes hex) */
  encryptionKey?: string;
  /** Enable audit logging */
  enableAuditLog: boolean;
  /** Custom patterns to detect */
  customPatterns: CustomPattern[];
  /** Names to always detect (whitelist) */
  knownNames: string[];
  /** Words to never anonymize (false positive prevention) */
  safeWords: string[];
  /** Maximum token retention time in hours */
  tokenRetentionHours: number;
  /** Session ID for token association */
  sessionId?: string;
}

/**
 * Custom pattern definition
 */
export interface CustomPattern {
  /** Pattern ID */
  id: string;
  /** Pattern name */
  name: string;
  /** Regex pattern (as string for serialization) */
  pattern: string;
  /** PII type to assign */
  type: PIIType;
  /** Placeholder format (use $n for groups) */
  placeholder: string;
  /** Confidence score */
  confidence: number;
  /** Whether this is high risk */
  highRisk: boolean;
}

/**
 * Anonymization statistics
 */
export interface AnonymizerStats {
  /** Total texts processed */
  totalProcessed: number;
  /** Total PII instances detected */
  totalPIIDetected: number;
  /** PII by type */
  piiByType: Record<PIIType, number>;
  /** Average processing time */
  avgProcessingTimeMs: number;
  /** Active tokens */
  activeTokens: number;
  /** Expired tokens cleaned */
  expiredTokensCleaned: number;
}

// ============================================================
// Constants and Patterns
// ============================================================

/**
 * PII detection patterns with confidence scores
 */
const PII_PATTERNS: Array<{
  type: PIIType;
  pattern: RegExp;
  confidence: number;
  highRisk: boolean;
  description: string;
}> = [
  // Email addresses
  {
    type: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    confidence: 0.95,
    highRisk: false,
    description: 'Email address',
  },

  // Phone numbers (various formats)
  {
    type: 'phone',
    pattern: /\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    confidence: 0.9,
    highRisk: false,
    description: 'US phone number',
  },
  {
    type: 'phone',
    pattern: /\b\+?[1-9]\d{1,14}\b/g,
    confidence: 0.7,
    highRisk: false,
    description: 'International phone number',
  },

  // Social Security Numbers
  {
    type: 'ssn',
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    confidence: 0.85,
    highRisk: true,
    description: 'Social Security Number',
  },

  // Credit card numbers (various formats)
  {
    type: 'credit_card',
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    confidence: 0.95,
    highRisk: true,
    description: 'Credit card number',
  },
  {
    type: 'credit_card',
    pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    confidence: 0.8,
    highRisk: true,
    description: 'Credit card number (formatted)',
  },

  // IP addresses
  {
    type: 'ip_address',
    pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    confidence: 0.9,
    highRisk: false,
    description: 'IPv4 address',
  },
  {
    type: 'ip_address',
    pattern: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
    confidence: 0.9,
    highRisk: false,
    description: 'IPv6 address',
  },

  // Dates of birth (various formats)
  {
    type: 'date_of_birth',
    pattern: /\b(?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12][0-9]|3[01])[-/](?:19|20)\d{2}\b/g,
    confidence: 0.7,
    highRisk: false,
    description: 'Date (MM/DD/YYYY)',
  },
  {
    type: 'date_of_birth',
    pattern: /\b(?:19|20)\d{2}[-/](?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12][0-9]|3[01])\b/g,
    confidence: 0.7,
    highRisk: false,
    description: 'Date (YYYY-MM-DD)',
  },

  // URLs (may contain sensitive paths)
  {
    type: 'url',
    pattern: /\bhttps?:\/\/[^\s<>"{}|\\^`[\]]+/g,
    confidence: 0.85,
    highRisk: false,
    description: 'URL',
  },

  // API keys (common patterns)
  {
    type: 'api_key',
    pattern: /\b(?:sk-|pk-|api[_-]?key[_-]?)[a-zA-Z0-9]{20,}\b/gi,
    confidence: 0.9,
    highRisk: true,
    description: 'API key',
  },
  {
    type: 'api_key',
    pattern: /\b[a-zA-Z0-9]{32,64}\b/g,
    confidence: 0.5,
    highRisk: true,
    description: 'Potential API key/token',
  },

  // Passwords (in common formats)
  {
    type: 'password',
    pattern: /(?:password|passwd|pwd)[\s:=]+["']?([^\s"']+)["']?/gi,
    confidence: 0.85,
    highRisk: true,
    description: 'Password in text',
  },

  // US addresses (street addresses)
  {
    type: 'address',
    pattern: /\b\d{1,5}\s+(?:[A-Za-z]+\s*){1,4}(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Lane|Ln|Drive|Dr|Court|Ct|Way|Circle|Cir|Place|Pl)\b\.?\s*(?:,?\s*(?:Apt|Suite|Unit|#)\s*\d+[A-Za-z]?)?\s*,?\s*[A-Za-z\s]+,?\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?\b/gi,
    confidence: 0.8,
    highRisk: false,
    description: 'US street address',
  },
];

/**
 * Common first names for name detection (partial list for entity recognition)
 */
const COMMON_FIRST_NAMES = new Set([
  // Male names
  'james', 'john', 'robert', 'michael', 'william', 'david', 'richard', 'joseph',
  'thomas', 'charles', 'christopher', 'daniel', 'matthew', 'anthony', 'mark',
  'donald', 'steven', 'paul', 'andrew', 'joshua', 'kenneth', 'kevin', 'brian',
  'george', 'timothy', 'ronald', 'edward', 'jason', 'jeffrey', 'ryan', 'jacob',
  'gary', 'nicholas', 'eric', 'jonathan', 'stephen', 'larry', 'justin', 'scott',
  'brandon', 'benjamin', 'samuel', 'raymond', 'gregory', 'frank', 'alexander',
  'patrick', 'jack', 'dennis', 'jerry', 'tyler', 'aaron', 'jose', 'adam', 'nathan',

  // Female names
  'mary', 'patricia', 'jennifer', 'linda', 'elizabeth', 'barbara', 'susan',
  'jessica', 'sarah', 'karen', 'lisa', 'nancy', 'betty', 'margaret', 'sandra',
  'ashley', 'kimberly', 'emily', 'donna', 'michelle', 'dorothy', 'carol',
  'amanda', 'melissa', 'deborah', 'stephanie', 'rebecca', 'sharon', 'laura',
  'cynthia', 'kathleen', 'amy', 'angela', 'shirley', 'anna', 'brenda', 'pamela',
  'emma', 'nicole', 'helen', 'samantha', 'katherine', 'christine', 'debra',
  'rachel', 'carolyn', 'janet', 'catherine', 'maria', 'heather', 'diane', 'ruth',
  'julie', 'olivia', 'joyce', 'virginia', 'victoria', 'kelly', 'lauren', 'christina',
]);

/**
 * Default configuration
 */
const DEFAULT_CONFIG: AnonymizerConfig = {
  defaultLevel: 'standard',
  enableReversible: true,
  enableAuditLog: true,
  customPatterns: [],
  knownNames: [],
  safeWords: [],
  tokenRetentionHours: 24,
};

/**
 * PII type to placeholder mapping
 */
const PLACEHOLDER_MAP: Record<PIIType, string> = {
  email: '[EMAIL]',
  phone: '[PHONE]',
  ssn: '[SSN]',
  credit_card: '[CARD]',
  ip_address: '[IP]',
  date_of_birth: '[DOB]',
  name: '[NAME]',
  address: '[ADDRESS]',
  url: '[URL]',
  api_key: '[API_KEY]',
  password: '[PASSWORD]',
  username: '[USERNAME]',
  custom: '[REDACTED]',
};

/**
 * PII types to detect at each level
 */
const LEVEL_PII_TYPES: Record<AnonymizationLevel, PIIType[]> = {
  minimal: ['ssn', 'credit_card', 'password', 'api_key'],
  standard: ['ssn', 'credit_card', 'password', 'api_key', 'email', 'phone', 'ip_address'],
  aggressive: ['ssn', 'credit_card', 'password', 'api_key', 'email', 'phone', 'ip_address', 'date_of_birth', 'address', 'name', 'url'],
  paranoid: ['ssn', 'credit_card', 'password', 'api_key', 'email', 'phone', 'ip_address', 'date_of_birth', 'address', 'name', 'url', 'username', 'custom'],
};

// ============================================================
// Data Anonymizer Class
// ============================================================

/**
 * Events emitted by the anonymizer
 */
export interface AnonymizerEvents {
  /** Emitted when PII is detected */
  piiDetected: (pii: DetectedPII[], text: string) => void;
  /** Emitted when text is anonymized */
  anonymized: (result: AnonymizationResult) => void;
  /** Emitted when text is deanonymized */
  deanonymized: (result: DeanonymizationResult) => void;
  /** Emitted when tokens are cleaned up */
  tokensCleaned: (count: number) => void;
}

/**
 * Data Anonymizer
 * Detects and masks PII in text with configurable levels and reversible options
 */
export class DataAnonymizer extends EventEmitter {
  private config: AnonymizerConfig;
  private tokens: Map<string, AnonymizationToken> = new Map();
  private valueHashToToken: Map<string, AnonymizationToken> = new Map();
  private encryptionKey: Buffer;
  private stats: AnonymizerStats = {
    totalProcessed: 0,
    totalPIIDetected: 0,
    piiByType: {} as Record<PIIType, number>,
    avgProcessingTimeMs: 0,
    activeTokens: 0,
    expiredTokensCleaned: 0,
  };
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config?: Partial<AnonymizerConfig>) {
    super();

    this.config = { ...DEFAULT_CONFIG, ...config };

    // Generate or use provided encryption key
    if (this.config.encryptionKey) {
      this.encryptionKey = Buffer.from(this.config.encryptionKey, 'hex');
    } else {
      this.encryptionKey = randomBytes(32);
    }

    // Initialize stats
    for (const type of Object.keys(PLACEHOLDER_MAP) as PIIType[]) {
      this.stats.piiByType[type] = 0;
    }

    // Start token cleanup interval
    this.startCleanupInterval();

    logger.info('DataAnonymizer initialized', {
      level: this.config.defaultLevel,
      reversible: this.config.enableReversible,
      customPatterns: this.config.customPatterns.length,
    });
  }

  // ============================================================
  // Public Methods
  // ============================================================

  /**
   * Anonymize text by detecting and masking PII
   */
  anonymize(
    text: string,
    options?: {
      level?: AnonymizationLevel;
      reversible?: boolean;
      sessionId?: string;
    }
  ): AnonymizationResult {
    const startTime = performance.now();
    const level = options?.level ?? this.config.defaultLevel;
    const reversible = options?.reversible ?? this.config.enableReversible;
    const sessionId = options?.sessionId ?? this.config.sessionId;

    // Detect all PII
    const detectedPII = this.detectPII(text, level);

    // If no PII detected, return early
    if (detectedPII.length === 0) {
      const result: AnonymizationResult = {
        original: text,
        anonymized: text,
        detectedPII: [],
        tokens: [],
        level,
        processingTimeMs: performance.now() - startTime,
        wasAnonymized: false,
      };

      this.updateStats(result);
      return result;
    }

    // Sort PII by position (descending) for safe replacement
    const sortedPII = [...detectedPII].sort((a, b) => b.startIndex - a.startIndex);

    // Anonymize and collect tokens
    let anonymized = text;
    const tokens: AnonymizationToken[] = [];

    for (const pii of sortedPII) {
      // Create token if reversible
      let token: AnonymizationToken | undefined;

      if (reversible) {
        token = this.createToken(pii.value, pii.type, sessionId);
        tokens.push(token);
      }

      // Create placeholder
      const placeholder = token?.placeholder ?? PLACEHOLDER_MAP[pii.type];

      // Replace in text
      anonymized =
        anonymized.substring(0, pii.startIndex) +
        placeholder +
        anonymized.substring(pii.endIndex);
    }

    const result: AnonymizationResult = {
      original: text,
      anonymized,
      detectedPII,
      tokens,
      level,
      processingTimeMs: performance.now() - startTime,
      wasAnonymized: true,
    };

    // Update stats
    this.updateStats(result);

    // Emit event
    this.emit('anonymized', result);

    // Audit log
    if (this.config.enableAuditLog) {
      this.logAnonymization(result);
    }

    return result;
  }

  /**
   * Deanonymize text using stored tokens
   */
  deanonymize(
    anonymizedText: string,
    tokenIds?: string[]
  ): DeanonymizationResult {
    let restored = anonymizedText;
    let tokensUsed = 0;
    let tokensFailed = 0;

    // Get tokens to use
    const tokensToUse = tokenIds
      ? tokenIds.map(id => this.tokens.get(id)).filter(Boolean) as AnonymizationToken[]
      : Array.from(this.tokens.values());

    // Sort by placeholder length (longest first) to avoid partial replacements
    const sortedTokens = [...tokensToUse].sort(
      (a, b) => b.placeholder.length - a.placeholder.length
    );

    for (const token of sortedTokens) {
      if (restored.includes(token.placeholder)) {
        try {
          const originalValue = this.decryptValue(token.encryptedValue, token.iv);
          restored = restored.replace(new RegExp(this.escapeRegex(token.placeholder), 'g'), originalValue);
          tokensUsed++;
        } catch (error) {
          logger.error('Failed to decrypt token', { tokenId: token.id, error: (error as Error).message });
          tokensFailed++;
        }
      }
    }

    const result: DeanonymizationResult = {
      anonymized: anonymizedText,
      restored,
      tokensUsed,
      tokensFailed,
      success: tokensFailed === 0 && tokensUsed > 0,
    };

    // Emit event
    this.emit('deanonymized', result);

    return result;
  }

  /**
   * Detect PII in text without anonymizing
   */
  detectPII(text: string, level?: AnonymizationLevel): DetectedPII[] {
    const effectiveLevel = level ?? this.config.defaultLevel;
    const typesToDetect = new Set(LEVEL_PII_TYPES[effectiveLevel]);
    const detected: DetectedPII[] = [];
    const coveredRanges: Array<{ start: number; end: number }> = [];

    // Apply built-in patterns
    for (const patternDef of PII_PATTERNS) {
      if (!typesToDetect.has(patternDef.type)) {
        continue;
      }

      // Reset pattern index
      patternDef.pattern.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = patternDef.pattern.exec(text)) !== null) {
        const startIndex = match.index;
        const endIndex = startIndex + match[0].length;

        // Skip if overlaps with existing detection
        if (this.overlapsWithExisting(startIndex, endIndex, coveredRanges)) {
          continue;
        }

        // Skip safe words
        if (this.isSafeWord(match[0])) {
          continue;
        }

        detected.push({
          type: patternDef.type,
          value: match[0],
          startIndex,
          endIndex,
          confidence: patternDef.confidence,
          matchedPattern: patternDef.description,
          highRisk: patternDef.highRisk,
        });

        coveredRanges.push({ start: startIndex, end: endIndex });
      }
    }

    // Apply custom patterns
    for (const customPattern of this.config.customPatterns) {
      if (!typesToDetect.has(customPattern.type)) {
        continue;
      }

      try {
        const regex = new RegExp(customPattern.pattern, 'gi');
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
          const startIndex = match.index;
          const endIndex = startIndex + match[0].length;

          if (this.overlapsWithExisting(startIndex, endIndex, coveredRanges)) {
            continue;
          }

          if (this.isSafeWord(match[0])) {
            continue;
          }

          detected.push({
            type: customPattern.type,
            value: match[0],
            startIndex,
            endIndex,
            confidence: customPattern.confidence,
            matchedPattern: customPattern.name,
            highRisk: customPattern.highRisk,
          });

          coveredRanges.push({ start: startIndex, end: endIndex });
        }
      } catch (error) {
        logger.warn('Invalid custom pattern', { patternId: customPattern.id, error: (error as Error).message });
      }
    }

    // Detect names if level includes names
    if (typesToDetect.has('name')) {
      const nameDetections = this.detectNames(text, coveredRanges);
      detected.push(...nameDetections);
    }

    // Emit event
    if (detected.length > 0) {
      this.emit('piiDetected', detected, text);
    }

    return detected;
  }

  /**
   * Get a specific token by ID
   */
  getToken(tokenId: string): AnonymizationToken | undefined {
    return this.tokens.get(tokenId);
  }

  /**
   * Get all tokens for a session
   */
  getSessionTokens(sessionId: string): AnonymizationToken[] {
    return Array.from(this.tokens.values()).filter(t => t.sessionId === sessionId);
  }

  /**
   * Clear tokens for a session
   */
  clearSessionTokens(sessionId: string): number {
    let cleared = 0;
    for (const [id, token] of this.tokens.entries()) {
      if (token.sessionId === sessionId) {
        this.tokens.delete(id);
        this.valueHashToToken.delete(token.valueHash);
        cleared++;
      }
    }
    this.stats.activeTokens = this.tokens.size;
    return cleared;
  }

  /**
   * Clear all tokens
   */
  clearAllTokens(): number {
    const count = this.tokens.size;
    this.tokens.clear();
    this.valueHashToToken.clear();
    this.stats.activeTokens = 0;
    return count;
  }

  /**
   * Get anonymization statistics
   */
  getStats(): AnonymizerStats {
    return { ...this.stats, activeTokens: this.tokens.size };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AnonymizerConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.encryptionKey) {
      this.encryptionKey = Buffer.from(config.encryptionKey, 'hex');
    }

    logger.info('Anonymizer configuration updated', { level: this.config.defaultLevel });
  }

  /**
   * Add a custom pattern
   */
  addCustomPattern(pattern: CustomPattern): void {
    // Validate pattern
    try {
      new RegExp(pattern.pattern);
    } catch {
      throw new Error(`Invalid regex pattern: ${pattern.pattern}`);
    }

    // Remove existing pattern with same ID
    this.config.customPatterns = this.config.customPatterns.filter(p => p.id !== pattern.id);
    this.config.customPatterns.push(pattern);

    logger.info('Custom pattern added', { patternId: pattern.id, name: pattern.name });
  }

  /**
   * Remove a custom pattern
   */
  removeCustomPattern(patternId: string): boolean {
    const initialLength = this.config.customPatterns.length;
    this.config.customPatterns = this.config.customPatterns.filter(p => p.id !== patternId);
    return this.config.customPatterns.length < initialLength;
  }

  /**
   * Add known names for detection
   */
  addKnownNames(names: string[]): void {
    const normalizedNames = names.map(n => n.toLowerCase().trim());
    this.config.knownNames = [...new Set([...this.config.knownNames, ...normalizedNames])];
  }

  /**
   * Add safe words (false positive prevention)
   */
  addSafeWords(words: string[]): void {
    const normalizedWords = words.map(w => w.toLowerCase().trim());
    this.config.safeWords = [...new Set([...this.config.safeWords, ...normalizedWords])];
  }

  /**
   * Shutdown the anonymizer
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    logger.info('DataAnonymizer shutdown', { tokensCleared: this.tokens.size });
    this.tokens.clear();
    this.valueHashToToken.clear();
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Create an anonymization token
   */
  private createToken(
    value: string,
    type: PIIType,
    sessionId?: string
  ): AnonymizationToken {
    // Check if we already have a token for this value
    const valueHash = this.hashValue(value);
    const existingToken = this.valueHashToToken.get(valueHash);

    if (existingToken) {
      return existingToken;
    }

    // Create new token
    const id = randomUUID();
    const { encrypted, iv } = this.encryptValue(value);
    const placeholder = `[${type.toUpperCase()}_${id.substring(0, 8)}]`;

    const token: AnonymizationToken = {
      id,
      encryptedValue: encrypted,
      iv,
      type,
      placeholder,
      timestamp: new Date().toISOString(),
      sessionId,
      valueHash,
    };

    // Store token
    this.tokens.set(id, token);
    this.valueHashToToken.set(valueHash, token);
    this.stats.activeTokens = this.tokens.size;

    return token;
  }

  /**
   * Encrypt a value for storage
   */
  private encryptValue(value: string): { encrypted: string; iv: string } {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return { encrypted, iv: iv.toString('hex') };
  }

  /**
   * Decrypt a value from storage
   */
  private decryptValue(encrypted: string, ivHex: string): string {
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Hash a value for deduplication
   */
  private hashValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /**
   * Detect names using entity recognition patterns
   */
  private detectNames(
    text: string,
    existingRanges: Array<{ start: number; end: number }>
  ): DetectedPII[] {
    const detected: DetectedPII[] = [];

    // Pattern 1: Known names from configuration
    for (const knownName of this.config.knownNames) {
      const regex = new RegExp(`\\b${this.escapeRegex(knownName)}\\b`, 'gi');
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const startIndex = match.index;
        const endIndex = startIndex + match[0].length;

        if (!this.overlapsWithExisting(startIndex, endIndex, existingRanges)) {
          detected.push({
            type: 'name',
            value: match[0],
            startIndex,
            endIndex,
            confidence: 0.95,
            matchedPattern: 'Known name',
            highRisk: false,
          });
          existingRanges.push({ start: startIndex, end: endIndex });
        }
      }
    }

    // Pattern 2: Title + Capitalized word(s) (e.g., "Mr. Smith", "Dr. John Smith")
    const titlePattern = /\b(Mr|Mrs|Ms|Miss|Dr|Prof|Professor|Sir|Madam|Rev)\.\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
    let match: RegExpExecArray | null;

    while ((match = titlePattern.exec(text)) !== null) {
      const startIndex = match.index;
      const endIndex = startIndex + match[0].length;

      if (!this.overlapsWithExisting(startIndex, endIndex, existingRanges)) {
        detected.push({
          type: 'name',
          value: match[0],
          startIndex,
          endIndex,
          confidence: 0.9,
          matchedPattern: 'Title + Name',
          highRisk: false,
        });
        existingRanges.push({ start: startIndex, end: endIndex });
      }
    }

    // Pattern 3: Common first names followed by capitalized word
    const namePattern = new RegExp(
      `\\b(${Array.from(COMMON_FIRST_NAMES).join('|')})\\s+([A-Z][a-z]+)\\b`,
      'gi'
    );

    while ((match = namePattern.exec(text)) !== null) {
      const startIndex = match.index;
      const endIndex = startIndex + match[0].length;
      const matchValue = match[0];

      // Verify first letter is capitalized (indicating proper noun)
      if (matchValue[0] === matchValue[0].toUpperCase()) {
        if (!this.overlapsWithExisting(startIndex, endIndex, existingRanges)) {
          if (!this.isSafeWord(matchValue)) {
            detected.push({
              type: 'name',
              value: matchValue,
              startIndex,
              endIndex,
              confidence: 0.75,
              matchedPattern: 'Common first name + Last name',
              highRisk: false,
            });
            existingRanges.push({ start: startIndex, end: endIndex });
          }
        }
      }
    }

    // Pattern 4: "my name is" / "I'm" followed by word(s)
    const introPattern = /\b(?:my name is|i'm|i am|call me|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/gi;

    while ((match = introPattern.exec(text)) !== null) {
      // Extract just the name part
      const fullMatch = match[0];
      const nameMatch = match[1];
      const nameStartIndex = match.index + fullMatch.indexOf(nameMatch);
      const nameEndIndex = nameStartIndex + nameMatch.length;

      if (!this.overlapsWithExisting(nameStartIndex, nameEndIndex, existingRanges)) {
        if (!this.isSafeWord(nameMatch)) {
          detected.push({
            type: 'name',
            value: nameMatch,
            startIndex: nameStartIndex,
            endIndex: nameEndIndex,
            confidence: 0.85,
            matchedPattern: 'Name introduction phrase',
            highRisk: false,
          });
          existingRanges.push({ start: nameStartIndex, end: nameEndIndex });
        }
      }
    }

    return detected;
  }

  /**
   * Check if a range overlaps with existing detections
   */
  private overlapsWithExisting(
    start: number,
    end: number,
    existing: Array<{ start: number; end: number }>
  ): boolean {
    for (const range of existing) {
      if (start < range.end && end > range.start) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a word is in the safe words list
   */
  private isSafeWord(word: string): boolean {
    const normalized = word.toLowerCase().trim();
    return this.config.safeWords.includes(normalized);
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Update statistics
   */
  private updateStats(result: AnonymizationResult): void {
    this.stats.totalProcessed++;
    this.stats.totalPIIDetected += result.detectedPII.length;

    for (const pii of result.detectedPII) {
      this.stats.piiByType[pii.type] = (this.stats.piiByType[pii.type] ?? 0) + 1;
    }

    // Update average processing time
    const totalTime = this.stats.avgProcessingTimeMs * (this.stats.totalProcessed - 1) + result.processingTimeMs;
    this.stats.avgProcessingTimeMs = totalTime / this.stats.totalProcessed;
  }

  /**
   * Log anonymization to audit log
   */
  private logAnonymization(result: AnonymizationResult): void {
    try {
      const auditLogger = getAuditLogger();

      auditLogger.log(
        'user_action',
        result.detectedPII.some(p => p.highRisk) ? 'warning' : 'info',
        `Data anonymized: ${result.detectedPII.length} PII instances masked`,
        {
          action: 'data_anonymization',
          allowed: true,
          source: 'anonymizer',
          context: {
            level: result.level,
            piiTypes: [...new Set(result.detectedPII.map(p => p.type))],
            piiCount: result.detectedPII.length,
            highRiskCount: count(result.detectedPII, p => p.highRisk),
            processingTimeMs: result.processingTimeMs,
            reversible: result.tokens.length > 0,
          },
        }
      );
    } catch (error) {
      logger.warn('Failed to log anonymization', { error: (error as Error).message });
    }
  }

  /**
   * Start periodic token cleanup
   */
  private startCleanupInterval(): void {
    // Run cleanup every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTokens();
    }, 60 * 60 * 1000);
  }

  /**
   * Clean up expired tokens
   */
  private cleanupExpiredTokens(): void {
    const now = new Date();
    const maxAgeMs = this.config.tokenRetentionHours * 60 * 60 * 1000;
    let cleaned = 0;

    for (const [id, token] of this.tokens.entries()) {
      const tokenAge = now.getTime() - new Date(token.timestamp).getTime();

      if (tokenAge > maxAgeMs) {
        this.tokens.delete(id);
        this.valueHashToToken.delete(token.valueHash);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.stats.expiredTokensCleaned += cleaned;
      this.stats.activeTokens = this.tokens.size;
      this.emit('tokensCleaned', cleaned);
      logger.debug('Expired tokens cleaned', { count: cleaned });
    }
  }
}

// ============================================================
// Singleton Management
// ============================================================

let anonymizerInstance: DataAnonymizer | null = null;

/**
 * Get or create the singleton DataAnonymizer instance
 */
export function getAnonymizer(config?: Partial<AnonymizerConfig>): DataAnonymizer {
  if (!anonymizerInstance) {
    anonymizerInstance = new DataAnonymizer(config);
  }
  return anonymizerInstance;
}

/**
 * Shutdown the anonymizer
 */
export function shutdownAnonymizer(): void {
  if (anonymizerInstance) {
    anonymizerInstance.shutdown();
    anonymizerInstance = null;
  }
}

// ============================================================
// Convenience Functions
// ============================================================

/**
 * Quick anonymize function using default settings
 */
export function anonymize(
  text: string,
  level?: AnonymizationLevel
): AnonymizationResult {
  return getAnonymizer().anonymize(text, { level });
}

/**
 * Quick detect PII function
 */
export function detectPII(
  text: string,
  level?: AnonymizationLevel
): DetectedPII[] {
  return getAnonymizer().detectPII(text, level);
}

/**
 * Quick deanonymize function
 */
export function deanonymize(
  text: string,
  tokenIds?: string[]
): DeanonymizationResult {
  return getAnonymizer().deanonymize(text, tokenIds);
}

export default DataAnonymizer;
