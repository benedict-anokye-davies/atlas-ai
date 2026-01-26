/**
 * Atlas Desktop - Security Types
 * Type definitions for security hardening systems
 *
 * @module security
 */

/**
 * Security event severity levels
 */
export type SecuritySeverity = 'info' | 'warning' | 'critical' | 'blocked';

/**
 * Security event categories
 */
export type SecurityEventCategory =
  | 'command_execution'
  | 'file_access'
  | 'prompt_injection'
  | 'input_validation'
  | 'rate_limit'
  | 'authentication'
  | 'authorization';

/**
 * Security audit log entry
 */
export interface SecurityAuditEntry {
  /** Unique identifier for this entry */
  id: string;
  /** ISO timestamp of when the event occurred */
  timestamp: string;
  /** Event category */
  category: SecurityEventCategory;
  /** Severity level */
  severity: SecuritySeverity;
  /** Human-readable event description */
  message: string;
  /** Action that was attempted */
  action: string;
  /** Whether the action was allowed */
  allowed: boolean;
  /** Reason for the decision */
  reason?: string;
  /** Source of the request (e.g., 'voice', 'text', 'tool') */
  source: string;
  /** User or session identifier */
  sessionId?: string;
  /** Additional context data */
  context?: Record<string, unknown>;
  /** Cryptographic hash of the entry for tamper detection */
  hash?: string;
  /** Hash of the previous entry (chain integrity) */
  previousHash?: string;
}

/**
 * Command validation result
 */
export interface CommandValidationResult {
  /** Whether the command is allowed to execute */
  allowed: boolean;
  /** Reason for the decision */
  reason: string;
  /** Severity of the blocked command (if blocked) */
  severity: SecuritySeverity;
  /** Risk level assessment */
  riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  /** Matched pattern that triggered the block (if any) */
  matchedPattern?: string;
  /** Sanitized version of the command (if applicable) */
  sanitizedCommand?: string;
  /** Whether confirmation is required */
  requiresConfirmation: boolean;
}

/**
 * Input validation result
 */
export interface InputValidationResult {
  /** Whether the input is safe */
  safe: boolean;
  /** Original input */
  original: string;
  /** Sanitized input (with dangerous patterns removed/escaped) */
  sanitized: string;
  /** Detected threats */
  threats: DetectedThreat[];
  /** Overall threat level */
  threatLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  /** User-friendly error message (if not safe) */
  message?: string;
  /** Actionable suggestion for fixing the input */
  suggestion?: string;
  /** Error code for programmatic handling */
  code?: string;
}

/**
 * Detected security threat
 */
export interface DetectedThreat {
  /** Type of threat detected */
  type: ThreatType;
  /** Pattern that was detected */
  pattern: string;
  /** Location in the input where the threat was found */
  location: {
    start: number;
    end: number;
  };
  /** Severity of the threat */
  severity: SecuritySeverity;
  /** Description of the threat */
  description: string;
}

/**
 * Types of security threats
 */
export type ThreatType =
  | 'prompt_injection'
  | 'command_injection'
  | 'path_traversal'
  | 'sql_injection'
  | 'xss_attempt'
  | 'shell_metachar'
  | 'unicode_exploit'
  | 'encoding_attack'
  | 'jailbreak_attempt';

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum requests per window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Burst allowance (extra requests allowed in short bursts) */
  burstLimit?: number;
}

/**
 * Rate limit status
 */
export interface RateLimitStatus {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining requests in current window */
  remaining: number;
  /** Time until window resets (ms) */
  resetIn: number;
  /** Current request count in window */
  currentCount: number;
}

/**
 * Command whitelist entry
 */
export interface WhitelistEntry {
  /** Command or pattern to allow */
  command: string;
  /** Whether this is a regex pattern */
  isPattern: boolean;
  /** Allowed arguments (if restricted) */
  allowedArgs?: string[];
  /** Blocked arguments (if any) */
  blockedArgs?: string[];
  /** Maximum execution time in ms */
  maxTimeout?: number;
  /** Required confirmation level */
  confirmationLevel: 'none' | 'low_risk' | 'medium_risk' | 'high_risk' | 'always';
  /** Description for audit logs */
  description: string;
}

/**
 * Security configuration
 */
export interface SecurityConfig {
  /** Enable command whitelisting (strict mode) */
  enableWhitelist: boolean;
  /** Enable dangerous pattern blocking */
  enablePatternBlocking: boolean;
  /** Enable input sanitization */
  enableInputSanitization: boolean;
  /** Enable rate limiting */
  enableRateLimiting: boolean;
  /** Enable audit logging */
  enableAuditLogging: boolean;
  /** Maximum command length */
  maxCommandLength: number;
  /** Maximum input length */
  maxInputLength: number;
  /** Rate limit config */
  rateLimit: RateLimitConfig;
  /** Path to audit log file */
  auditLogPath?: string;
  /** Whether to block on suspicious input (vs just log) */
  blockSuspiciousInput: boolean;
}

/**
 * Default security configuration
 */
export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  enableWhitelist: true,
  enablePatternBlocking: true,
  enableInputSanitization: true,
  enableRateLimiting: true,
  enableAuditLogging: true,
  maxCommandLength: 4096,
  maxInputLength: 10000,
  rateLimit: {
    maxRequests: 30,
    windowMs: 60000, // 1 minute
    burstLimit: 5,
  },
  blockSuspiciousInput: true,
};

/**
 * Dangerous command patterns - CRITICAL SECURITY
 * These patterns are ALWAYS blocked regardless of whitelist
 */
export const CRITICAL_BLOCKED_PATTERNS = [
  // Fork bombs - various forms
  /:\s*\(\s*\)\s*\{.*:\s*\|\s*:.*&.*\}\s*;?\s*:/, // Classic bash fork bomb :(){ :|:& };:
  /\.\s*\(\s*\)\s*\{.*\.\s*\|\s*\..*&.*\}/, // Alternative form with dots
  /fork.*bomb/i, // Explicit fork bomb mentions
  /\$\{:\|:&\}/,

  // Root filesystem destruction
  /rm\s+(-[rf]+\s+)*\//i,
  /rm\s+(-[rf]+\s+)*\/\*/i,
  /rm\s+(-[rf]+\s+)*~\//i,
  /del\s+\/[sfq]+\s+[cC]:\\/i,
  /rmdir\s+\/[sq]+\s+[cC]:\\/i,

  // System file modification
  />\s*\/etc\//i,
  />\s*\/dev\/sd/i,
  /dd\s+.*of=\/dev\//i,
  /mkfs/i,
  /fdisk/i,
  /parted/i,

  // Credential theft
  /cat\s+.*\/etc\/shadow/i,
  /cat\s+.*\/etc\/passwd/i,
  /cat\s+.*\.ssh\/id_/i,
  /cat\s+.*\.gnupg/i,
  /cat\s+.*\.aws\/credentials/i,

  // Remote code execution
  /curl\s+.*\|\s*(ba)?sh/i,
  /wget\s+.*\|\s*(ba)?sh/i,
  /curl\s+.*\|\s*sudo/i,
  /wget\s+.*\|\s*sudo/i,
  /bash\s+-c\s+.*\$\(/i,
  /eval\s*\(/i,

  // Reverse shells
  /nc\s+-[el]/i,
  /ncat\s+-[el]/i,
  /netcat\s+-[el]/i,
  /bash\s+-i\s+>&/i,
  /\/dev\/tcp\//i,

  // Registry attacks (Windows)
  /reg\s+(delete|add)\s+HK(LM|CR)/i,

  // Environment variable attacks
  /export\s+LD_PRELOAD/i,
  /export\s+DYLD_INSERT_LIBRARIES/i,

  // Process injection
  /ptrace/i,
  /\/proc\/.*\/mem/i,
] as const;

/**
 * Prompt injection patterns to detect
 */
export const PROMPT_INJECTION_PATTERNS = [
  // Direct instruction overrides - more flexible patterns
  /ignore\s+(all\s+)?(previous|prior|above|your)?\s*(instructions?|prompts?|rules?|guidelines?)?/i,
  /disregard\s+(all\s+)?(previous|prior|above)?\s*(instructions?|prompts?|rules?)?/i,
  /forget\s+(all\s+)?(previous|prior|above|your)?\s*(instructions?|prompts?|rules?)?/i,
  /override\s+(all\s+)?(safety|security|restrictions?|guidelines?)/i,

  // Role manipulation
  /you\s+are\s+(now|no\s+longer)/i,
  /pretend\s+(you're|you\s+are|to\s+be)/i,
  /act\s+as\s+(if|though|a)/i,
  /roleplay\s+as/i,
  /assume\s+the\s+role/i,

  // Jailbreak attempts - more flexible
  /\bDAN\b.*mode/i,
  /developer\s+mode/i,
  /jailbreak/i,
  /bypass\s+.*(safety|security|filter|restriction)/i, // More flexible - matches "bypass your safety filter"
  /unrestricted\s+mode/i,
  /without\s+(any\s+)?(restrictions?|limits?|guidelines?)/i,

  // System prompt extraction - more flexible
  /what\s+(is|are)\s+(your|the)\s+(system\s+)?prompt/i,
  /show\s+(me\s+)?(your|the)\s+(system\s+)?prompt/i,
  /reveal\s+(your|the)\s+(system\s+)?prompt/i,
  /print\s+(your|the)\s+(system\s+)?(prompt|instructions?)/i, // Match 'print your system instructions'
  /output\s+(your|the)\s+(system\s+)?instructions/i,
  /reveal\s+secrets?/i,

  // Encoding attacks (trying to hide malicious content)
  /base64\s*(encode|decode)/i,
  /\\x[0-9a-f]{2}/i,
  /&#x?[0-9a-f]+;/i,

  // Control character injection
  // eslint-disable-next-line no-control-regex
  /[\x00-\x08\x0b\x0c\x0e-\x1f]/,
] as const;

/**
 * Shell metacharacters that need escaping
 */
export const SHELL_METACHARACTERS = [
  '|', // Pipe
  '&', // Background/AND
  ';', // Command separator
  '$', // Variable expansion
  '`', // Command substitution
  '(', // Subshell
  ')',
  '{', // Brace expansion
  '}',
  '<', // Redirection
  '>',
  '!', // History expansion
  '\\', // Escape
  '"', // Quoting
  "'",
  '\n', // Newline (command separator)
  '\r',
  '\t',
  '*', // Glob
  '?',
  '[',
  ']',
  '#', // Comment
  '~', // Home directory
] as const;

/**
 * Command whitelist - commands that are allowed by default
 * Each entry specifies what arguments/flags are permitted
 */
export const DEFAULT_COMMAND_WHITELIST: WhitelistEntry[] = [
  // Safe read-only commands
  {
    command: 'ls',
    isPattern: false,
    allowedArgs: ['-l', '-a', '-la', '-al', '-lh', '-alh', '-R'],
    maxTimeout: 10000,
    confirmationLevel: 'none',
    description: 'List directory contents',
  },
  {
    command: 'dir',
    isPattern: false,
    allowedArgs: ['/b', '/s', '/w'],
    maxTimeout: 10000,
    confirmationLevel: 'none',
    description: 'List directory contents (Windows)',
  },
  {
    command: 'pwd',
    isPattern: false,
    maxTimeout: 5000,
    confirmationLevel: 'none',
    description: 'Print working directory',
  },
  {
    command: 'cd',
    isPattern: false,
    maxTimeout: 5000,
    confirmationLevel: 'none',
    description: 'Change directory',
  },
  {
    command: 'cat',
    isPattern: false,
    maxTimeout: 10000,
    confirmationLevel: 'none',
    description: 'Display file contents',
  },
  {
    command: 'head',
    isPattern: false,
    allowedArgs: ['-n', '-c'],
    maxTimeout: 10000,
    confirmationLevel: 'none',
    description: 'Display first lines of file',
  },
  {
    command: 'tail',
    isPattern: false,
    allowedArgs: ['-n', '-c', '-f'],
    maxTimeout: 30000,
    confirmationLevel: 'none',
    description: 'Display last lines of file',
  },
  {
    command: 'echo',
    isPattern: false,
    maxTimeout: 5000,
    confirmationLevel: 'none',
    description: 'Print text',
  },
  {
    command: 'which',
    isPattern: false,
    maxTimeout: 5000,
    confirmationLevel: 'none',
    description: 'Locate a command',
  },
  {
    command: 'where',
    isPattern: false,
    maxTimeout: 5000,
    confirmationLevel: 'none',
    description: 'Locate a command (Windows)',
  },
  {
    command: 'type',
    isPattern: false,
    maxTimeout: 10000,
    confirmationLevel: 'none',
    description: 'Display file contents (Windows)',
  },
  {
    command: 'whoami',
    isPattern: false,
    maxTimeout: 5000,
    confirmationLevel: 'none',
    description: 'Print current user',
  },
  {
    command: 'hostname',
    isPattern: false,
    maxTimeout: 5000,
    confirmationLevel: 'none',
    description: 'Print hostname',
  },
  {
    command: 'date',
    isPattern: false,
    maxTimeout: 5000,
    confirmationLevel: 'none',
    description: 'Print date/time',
  },
  {
    command: 'find',
    isPattern: false,
    blockedArgs: ['-exec', '-delete', '-ok'],
    maxTimeout: 60000,
    confirmationLevel: 'none',
    description: 'Find files',
  },
  {
    command: 'grep',
    isPattern: false,
    allowedArgs: ['-r', '-n', '-i', '-l', '-c', '-v', '-E', '-w'],
    maxTimeout: 60000,
    confirmationLevel: 'none',
    description: 'Search file contents',
  },
  {
    command: 'wc',
    isPattern: false,
    allowedArgs: ['-l', '-w', '-c', '-m'],
    maxTimeout: 10000,
    confirmationLevel: 'none',
    description: 'Word count',
  },
  {
    command: 'sort',
    isPattern: false,
    allowedArgs: ['-n', '-r', '-u', '-k'],
    maxTimeout: 30000,
    confirmationLevel: 'none',
    description: 'Sort lines',
  },

  // Development tools - low risk
  {
    command: 'node',
    isPattern: false,
    blockedArgs: ['--eval', '-e'],
    maxTimeout: 300000,
    confirmationLevel: 'low_risk',
    description: 'Run Node.js',
  },
  {
    command: 'npm',
    isPattern: false,
    blockedArgs: ['publish', 'unpublish', 'deprecate'],
    maxTimeout: 300000,
    confirmationLevel: 'low_risk',
    description: 'Node package manager',
  },
  {
    command: 'npx',
    isPattern: false,
    maxTimeout: 300000,
    confirmationLevel: 'medium_risk',
    description: 'Execute npm packages',
  },
  {
    command: 'yarn',
    isPattern: false,
    blockedArgs: ['publish'],
    maxTimeout: 300000,
    confirmationLevel: 'low_risk',
    description: 'Yarn package manager',
  },
  {
    command: 'pnpm',
    isPattern: false,
    blockedArgs: ['publish'],
    maxTimeout: 300000,
    confirmationLevel: 'low_risk',
    description: 'PNPM package manager',
  },
  {
    command: 'python',
    isPattern: false,
    blockedArgs: ['-c'],
    maxTimeout: 300000,
    confirmationLevel: 'low_risk',
    description: 'Run Python',
  },
  {
    command: 'python3',
    isPattern: false,
    blockedArgs: ['-c'],
    maxTimeout: 300000,
    confirmationLevel: 'low_risk',
    description: 'Run Python 3',
  },
  {
    command: 'pip',
    isPattern: false,
    maxTimeout: 300000,
    confirmationLevel: 'low_risk',
    description: 'Python package manager',
  },
  {
    command: 'pip3',
    isPattern: false,
    maxTimeout: 300000,
    confirmationLevel: 'low_risk',
    description: 'Python 3 package manager',
  },

  // Git - mostly safe
  {
    command: 'git',
    isPattern: false,
    blockedArgs: ['push --force', 'reset --hard', 'clean -f', 'push -f'],
    maxTimeout: 120000,
    confirmationLevel: 'low_risk',
    description: 'Git version control',
  },

  // File operations - medium risk
  {
    command: 'cp',
    isPattern: false,
    blockedArgs: ['-rf /'],
    maxTimeout: 60000,
    confirmationLevel: 'medium_risk',
    description: 'Copy files',
  },
  {
    command: 'mv',
    isPattern: false,
    maxTimeout: 60000,
    confirmationLevel: 'medium_risk',
    description: 'Move/rename files',
  },
  {
    command: 'mkdir',
    isPattern: false,
    allowedArgs: ['-p'],
    maxTimeout: 10000,
    confirmationLevel: 'low_risk',
    description: 'Create directory',
  },
  {
    command: 'touch',
    isPattern: false,
    maxTimeout: 5000,
    confirmationLevel: 'low_risk',
    description: 'Create empty file',
  },

  // Dangerous operations - high risk / always confirm
  {
    command: 'rm',
    isPattern: false,
    blockedArgs: ['-rf /', '-rf /*', '-rf ~'],
    maxTimeout: 60000,
    confirmationLevel: 'high_risk',
    description: 'Remove files (DANGEROUS)',
  },
  {
    command: 'del',
    isPattern: false,
    blockedArgs: ['/F /S /Q C:\\'],
    maxTimeout: 60000,
    confirmationLevel: 'high_risk',
    description: 'Delete files (Windows) (DANGEROUS)',
  },
  {
    command: 'rmdir',
    isPattern: false,
    maxTimeout: 60000,
    confirmationLevel: 'high_risk',
    description: 'Remove directory (DANGEROUS)',
  },
];

/**
 * Keychain configuration
 */
export interface KeychainConfig {
  /** Whether to use OS keychain (true) or fallback only (false) */
  useOsKeychain: boolean;
  /** Path to fallback encrypted storage file */
  fallbackPath?: string;
  /** Source for encryption key derivation */
  encryptionKeySource: 'machine' | 'user' | 'custom';
  /** Custom encryption key (only if encryptionKeySource is 'custom') */
  customKey?: string;
}

/**
 * Result of a keychain operation
 */
export interface KeychainResult {
  /** Whether the operation was successful */
  success: boolean;
  /** Error message if operation failed */
  error?: string;
  /** Storage type used (if applicable) */
  storage?: 'keychain' | 'fallback' | 'both';
}

/**
 * Information about a stored key
 */
export interface StoredKeyInfo {
  /** Key name */
  name: string;
  /** Where the key is stored */
  storage: 'keychain' | 'fallback' | 'both';
  /** Whether the key has a value */
  hasValue: boolean;
}

/**
 * Migration status tracking
 */
export interface MigrationStatus {
  /** Whether migration has been performed */
  migrated: boolean;
  /** ISO timestamp of migration */
  migrationDate: string | null;
  /** Keys that were migrated */
  migratedKeys: string[];
  /** Migration schema version */
  version: number;
}

/**
 * Result of a key migration operation
 */
export interface MigrationResult {
  /** Whether migration was successful */
  success: boolean;
  /** Keys that were migrated */
  migratedKeys: string[];
  /** Keys that were skipped (already migrated or empty) */
  skippedKeys: string[];
  /** Error messages if any */
  errors: string[];
  /** Whether migration was already completed */
  alreadyMigrated: boolean;
  /** Path to backup file if created */
  backupPath?: string;
}

/**
 * Path patterns that are blocked from access
 */
export const BLOCKED_PATH_PATTERNS = [
  // System directories (Unix)
  /^\/etc\/shadow$/i,
  /^\/etc\/passwd$/i,
  /^\/etc\/sudoers/i,
  /^\/root\//i,
  /^\/boot\//i,
  /^\/sys\//i,
  /^\/proc\//i,

  // System directories (Windows)
  /^[A-Z]:\\Windows\\System32/i,
  /^[A-Z]:\\Windows\\SysWOW64/i,
  /^[A-Z]:\\Windows\\system\.ini/i,
  /^[A-Z]:\\Windows\\win\.ini/i,

  // Sensitive user files
  /\.ssh\/id_/i,
  /\.ssh\/known_hosts/i,
  /\.gnupg\//i,
  /\.aws\/credentials/i,
  /\.azure\//i,
  /\.gcloud\//i,
  /\.kube\/config/i,
  /\.docker\/config\.json/i,

  // Secrets and keys
  /\.env$/i,
  /\.env\.[a-z]+$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /secrets?\.(json|ya?ml|toml)$/i,
  /credentials?\.(json|ya?ml|toml)$/i,

  // Path traversal attempts
  /\.\.\//,
  /\.\.\\/, // Windows variant
] as const;

// ============================================================================
// File Guard Types
// ============================================================================

/**
 * File access permission types
 */
export type FileAccessPermission = 'read' | 'write' | 'create' | 'delete' | 'list';

/**
 * File operation types
 */
export type FileOperationType = 'read' | 'write' | 'create' | 'delete' | 'list';

/**
 * Directory permission entry
 */
export interface DirectoryPermission {
  /** The directory path */
  path: string;
  /** Permissions granted for this directory */
  permissions: FileAccessPermission[];
  /** When the permission was granted */
  grantedAt: number;
  /** Who granted the permission (system, user, etc.) */
  grantedBy: string;
  /** When the permission expires (undefined = never) */
  expiresAt?: number;
}

/**
 * File access result
 */
export interface FileAccessResult {
  /** Whether access is allowed */
  allowed: boolean;
  /** Original path requested */
  path: string;
  /** Normalized/resolved path */
  normalizedPath: string;
  /** The operation that was checked */
  operation: FileOperationType;
  /** Reason for the decision */
  reason?: string;
  /** Whether the path is blocked (security concern) */
  isBlocked?: boolean;
  /** Whether user prompt is required */
  requiresPrompt?: boolean;
}

/**
 * Path validation result
 */
export interface PathValidationResult {
  /** Whether the path is valid */
  valid: boolean;
  /** Normalized path */
  normalizedPath: string;
  /** List of issues found */
  issues: string[];
  /** Whether the path is blocked for security reasons */
  isBlocked?: boolean;
}

/**
 * File Guard configuration
 */
export interface FileGuardConfig {
  /** Enable user prompts for new directory access */
  enableUserPrompts: boolean;
  /** Maximum path length allowed */
  maxPathLength: number;
  /** Maximum file size for read/write operations */
  maxFileSize: number;
  /** Default timeout for file operations (ms) */
  defaultTimeout: number;
  /** Session ID for tracking */
  sessionId?: string;
}

/**
 * Default File Guard configuration
 */
export const DEFAULT_FILE_GUARD_CONFIG: FileGuardConfig = {
  enableUserPrompts: true,
  maxPathLength: 4096,
  maxFileSize: 50 * 1024 * 1024, // 50MB
  defaultTimeout: 30000, // 30 seconds
};

/**
 * System-level blocked paths (always blocked regardless of whitelist)
 */
export const SYSTEM_BLOCKED_PATHS: (string | RegExp)[] = [
  // Unix system directories
  '/etc/shadow',
  '/etc/passwd',
  '/etc/sudoers',
  '/etc/sudoers.d',
  /^\/root\//i,
  /^\/boot\//i,
  /^\/sys\//i,
  /^\/proc\//i,
  /^\/dev\//i,

  // Windows system directories
  /^[A-Z]:\\Windows\\System32/i,
  /^[A-Z]:\\Windows\\SysWOW64/i,
  /^[A-Z]:\\Windows\\system\.ini$/i,
  /^[A-Z]:\\Windows\\win\.ini$/i,
  /^[A-Z]:\\Windows\\System\\config/i,
  /^[A-Z]:\\ProgramData\\Microsoft\\Windows\\Start Menu/i,

  // macOS system directories
  /^\/System\//i,
  /^\/Library\/Preferences\/SystemConfiguration/i,

  // User sensitive directories
  /\.ssh\//i,
  /\.gnupg\//i,
  /\.password-store\//i,
];

/**
 * Sensitive file patterns (blocked from all access)
 */
export const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  // SSH keys
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)\.pub$/i,
  /^known_hosts$/i,
  /^authorized_keys$/i,

  // Credentials and secrets
  /^\.env$/i,
  /^\.env\.[a-z]+$/i,
  /^\.netrc$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^credentials\.json$/i,
  /^secrets?\.json$/i,
  /^secrets?\.(ya?ml|toml)$/i,

  // Certificates and keys
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.jks$/i,
  /\.keystore$/i,

  // Wallets and crypto
  /^wallet\.dat$/i,
  /^keystore$/i,

  // Browser data
  /^Login Data$/i,
  /^Cookies$/i,
  /^History$/i,

  // Password managers
  /\.kdbx$/i, // KeePass
  /^1password\.sqlite$/i,
  /^logins\.json$/i, // Firefox
];

// ============================================================================
// Sandbox Types
// ============================================================================

/**
 * Resource limits for sandboxed execution
 */
export interface SandboxResourceLimits {
  /** Maximum execution time (ms) */
  maxExecutionTime: number;
  /** Maximum memory usage (bytes) - advisory only */
  maxMemory: number;
  /** Maximum output size (bytes) */
  maxOutputSize: number;
  /** Maximum number of files that can be accessed */
  maxFileAccess: number;
  /** Maximum number of network requests */
  maxNetworkRequests: number;
}

/**
 * Sandbox execution context
 */
export interface SandboxExecutionContext {
  /** Unique execution ID */
  executionId: string;
  /** Tool being executed */
  toolName: string;
  /** Parameters passed to the tool */
  params: Record<string, unknown>;
  /** Start time */
  startTime: number;
  /** Session ID */
  sessionId: string;
  /** Resource limits */
  resourceLimits: SandboxResourceLimits;
  /** Working directory */
  workingDirectory: string;
  /** Environment variables */
  environmentVariables: Record<string, string>;
  /** File guard instance (injected) */
  fileGuard?: unknown;
  /** Terminal executor instance (injected) */
  terminalExecutor?: unknown;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Sandbox execution result
 */
export interface SandboxExecutionResult<T = unknown> {
  /** Whether execution succeeded */
  success: boolean;
  /** Execution ID */
  executionId: string;
  /** Tool name */
  toolName: string;
  /** Result data (if successful) */
  result?: T;
  /** Error message (if failed) */
  error?: string;
  /** Execution duration (ms) */
  duration: number;
  /** Start time */
  startTime: number;
  /** End time */
  endTime: number;
  /** Resources used */
  resourcesUsed?: {
    memoryPeak?: number;
    filesAccessed?: number;
    networkRequests?: number;
  };
}

/**
 * Tool execution record for history
 */
export interface ToolExecutionRecord {
  /** Unique execution ID */
  id: string;
  /** Tool name */
  toolName: string;
  /** Parameters (sanitized) */
  params: Record<string, unknown>;
  /** Start time */
  startTime: number;
  /** End time */
  endTime: number;
  /** Duration (ms) */
  duration: number;
  /** Whether execution succeeded */
  success: boolean;
  /** Result (if successful) */
  result?: unknown;
  /** Error message (if failed) */
  error?: string;
  /** Session ID */
  sessionId: string;
  /** Source of the request */
  source: string;
}

/**
 * Sandbox configuration
 */
export interface SandboxConfig {
  /** Maximum concurrent executions */
  maxConcurrentExecutions: number;
  /** Default execution timeout (ms) */
  defaultTimeout: number;
  /** Resource limits */
  resourceLimits: SandboxResourceLimits;
  /** Working directory for executions */
  workingDirectory?: string;
  /** Environment variables to inject */
  environmentVariables: Record<string, string>;
  /** Maximum history size to keep */
  maxHistorySize?: number;
  /** Session ID */
  sessionId?: string;
}

/**
 * Default resource limits
 */
export const DEFAULT_RESOURCE_LIMITS: SandboxResourceLimits = {
  maxExecutionTime: 60000, // 1 minute
  maxMemory: 256 * 1024 * 1024, // 256MB
  maxOutputSize: 10 * 1024 * 1024, // 10MB
  maxFileAccess: 100,
  maxNetworkRequests: 10,
};

/**
 * Default sandbox configuration
 */
export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  maxConcurrentExecutions: 5,
  defaultTimeout: 60000, // 1 minute
  resourceLimits: DEFAULT_RESOURCE_LIMITS,
  environmentVariables: {},
  maxHistorySize: 1000,
};

// ============================================================================
// Auto-Lock Types
// ============================================================================

/**
 * Lock level determines what gets locked
 */
export type LockLevel = 'full' | 'sensitive_only' | 'none';

/**
 * Unlock method types
 */
export type UnlockMethod = 'password' | 'biometric' | 'pin' | 'none';

/**
 * Reason for locking
 */
export type LockReason =
  | 'idle_timeout'
  | 'manual_lock'
  | 'voice_command'
  | 'system_lock'
  | 'display_off'
  | 'failed_attempts'
  | 'app_start';

/**
 * Auto-lock configuration
 */
export interface AutoLockConfig {
  /** Whether auto-lock is enabled */
  enabled: boolean;

  /** Idle time before locking (in milliseconds) */
  idleTimeoutMs: number;

  /** Time to show warning before locking (in milliseconds) */
  warningTimeMs: number;

  /** Lock level to apply */
  lockLevel: LockLevel;

  /** Unlock method to use */
  unlockMethod: UnlockMethod;

  /** Lock when system locks/sleeps */
  lockOnSystemLock: boolean;

  /** Lock when display turns off */
  lockOnDisplayOff: boolean;

  /** Quick unlock keyboard shortcut (e.g., 'CommandOrControl+Shift+U') */
  unlockShortcut: string;

  /** Quick lock keyboard shortcut (e.g., 'CommandOrControl+Shift+L') */
  lockShortcut: string;

  /** Enable voice command "Lock Atlas" */
  enableVoiceLock: boolean;

  /** Show notification before locking */
  showLockNotification: boolean;

  /** Auto-lock after failed unlock attempts */
  maxUnlockAttempts: number;

  /** Lockout duration after max failed attempts (in milliseconds) */
  lockoutDurationMs: number;

  /** Operations that require unlock when in 'sensitive_only' mode */
  sensitiveOperations: string[];
}

/**
 * Default auto-lock configuration
 */
export const DEFAULT_AUTO_LOCK_CONFIG: AutoLockConfig = {
  enabled: true,
  idleTimeoutMs: 5 * 60 * 1000, // 5 minutes
  warningTimeMs: 30 * 1000, // 30 seconds warning
  lockLevel: 'full',
  unlockMethod: 'password',
  lockOnSystemLock: true,
  lockOnDisplayOff: true,
  unlockShortcut: 'CommandOrControl+Shift+U',
  lockShortcut: 'CommandOrControl+Shift+L',
  enableVoiceLock: true,
  showLockNotification: true,
  maxUnlockAttempts: 5,
  lockoutDurationMs: 5 * 60 * 1000, // 5 minute lockout
  sensitiveOperations: [
    'terminal_execute',
    'file_delete',
    'file_write',
    'system_settings',
    'browser_automation',
    'git_push',
    'api_key_access',
    'memory_clear',
  ],
};

/**
 * Lock state information
 */
export interface LockState {
  /** Whether the system is locked */
  isLocked: boolean;

  /** Current lock level */
  lockLevel: LockLevel;

  /** When the lock was activated */
  lockedAt: number | null;

  /** Number of failed unlock attempts */
  failedAttempts: number;

  /** Whether currently in lockout */
  isLockedOut: boolean;

  /** When lockout ends (if in lockout) */
  lockoutEndsAt: number | null;

  /** Session ID of who locked */
  lockedBySession: string | null;

  /** Lock reason */
  lockReason: LockReason;
}

/**
 * Unlock result
 */
export interface UnlockResult {
  /** Whether unlock was successful */
  success: boolean;

  /** Error message if failed */
  error?: string;

  /** Remaining attempts if failed */
  remainingAttempts?: number;

  /** Lockout time remaining if locked out */
  lockoutRemainingMs?: number;
}
