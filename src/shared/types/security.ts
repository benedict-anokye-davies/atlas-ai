/**
 * Nova Desktop - Security Types
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
