/**
 * Nova Desktop - Agent Types
 * Type definitions for the agent system
 */

/**
 * Agent action result
 */
export interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Agent tool definition
 */
export interface AgentTool {
  /** Unique tool identifier */
  name: string;
  /** Human-readable description */
  description: string;
  /** JSON schema for tool parameters */
  parameters: Record<string, unknown>;
  /** Tool execution function */
  execute: (params: Record<string, unknown>) => Promise<ActionResult>;
}

/**
 * Tool parameter schema (JSON Schema compatible)
 */
export interface ToolParameterSchema {
  type: 'object' | 'string' | 'number' | 'boolean' | 'array';
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
  description?: string;
}

export interface ToolParameterProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: ToolParameterProperty;
}

/**
 * Tool execution result
 */
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Tool definition interface
 */
export interface ToolDefinition {
  /** Unique tool identifier */
  name: string;
  /** Human-readable description for LLM */
  description: string;
  /** JSON schema for parameters */
  parameters: ToolParameterSchema;
  /** Whether tool requires user confirmation */
  requiresConfirmation?: boolean;
  /** Tool category for organization */
  category?: ToolCategory;
  /** Risk level - affects confirmation requirements */
  riskLevel?: 'low' | 'medium' | 'high';
}

/**
 * Tool categories
 */
export type ToolCategory =
  | 'filesystem'
  | 'terminal'
  | 'browser'
  | 'system'
  | 'memory'
  | 'search'
  | 'utility';

/**
 * File system operation types
 */
export type FileOperation =
  | 'read'
  | 'write'
  | 'append'
  | 'delete'
  | 'list'
  | 'search'
  | 'copy'
  | 'move';

/**
 * File info returned by filesystem operations
 */
export interface FileInfo {
  path: string;
  name: string;
  isDirectory: boolean;
  size: number;
  modified: string;
  created: string;
  extension?: string;
}

/**
 * File read result
 */
export interface FileReadResult {
  path: string;
  content: string;
  encoding: string;
  size: number;
  lines: number;
  truncated?: boolean;
}

/**
 * File write result
 */
export interface FileWriteResult {
  path: string;
  bytesWritten: number;
  created: boolean;
}

/**
 * File search result
 */
export interface FileSearchResult {
  files: FileInfo[];
  totalMatches: number;
  searchPath: string;
  pattern: string;
}

/**
 * Directory listing result
 */
export interface DirectoryListResult {
  path: string;
  entries: FileInfo[];
  totalFiles: number;
  totalDirectories: number;
  totalSize: number;
}

/**
 * Terminal command execution options
 */
export interface TerminalExecuteOptions {
  /** Working directory for command execution */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Shell to use (default: system shell) */
  shell?: string;
  /** Maximum output size in bytes (default: 1MB) */
  maxOutputSize?: number;
}

/**
 * Terminal execution result
 */
export interface TerminalResult {
  /** Exit code (0 = success) */
  exitCode: number;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Command that was executed */
  command: string;
  /** Working directory */
  cwd: string;
  /** Execution duration in ms */
  duration: number;
  /** Whether output was truncated */
  truncated?: boolean;
  /** Whether command timed out */
  timedOut?: boolean;
}

/**
 * Tool execution context
 */
export interface ToolExecutionContext {
  /** User ID making the request */
  userId: string;
  /** Session ID */
  sessionId: string;
  /** Request timestamp */
  timestamp: number;
  /** Whether to skip confirmation for dangerous operations */
  skipConfirmation?: boolean;
  /** Parent tool call (for chained calls) */
  parentCallId?: string;
}

/**
 * Tool call record (for logging/auditing)
 */
export interface ToolCallRecord {
  id: string;
  toolName: string;
  parameters: Record<string, unknown>;
  result: ToolResult;
  context: ToolExecutionContext;
  startTime: number;
  endTime: number;
  duration: number;
}

/**
 * Safety validation result
 */
export interface SafetyValidation {
  allowed: boolean;
  reason?: string;
  riskLevel: 'low' | 'medium' | 'high' | 'blocked';
  requiresConfirmation: boolean;
}

/**
 * Blocked path patterns for filesystem safety
 */
export const BLOCKED_PATHS = [
  // System directories
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
  // Windows system
  'C:\\Windows\\System32',
  'C:\\Windows\\SysWOW64',
  // User sensitive
  '.ssh/id_rsa',
  '.ssh/id_ed25519',
  '.gnupg',
  '.aws/credentials',
  // Nova internal
  '.env',
  '*.pem',
  '*.key',
] as const;

/**
 * Blocked command patterns for terminal safety
 */
export const BLOCKED_COMMANDS = [
  // Destructive commands
  'rm -rf /',
  'rm -rf /*',
  'rm -rf ~',
  'del /F /S /Q C:\\',
  'format',
  ':(){:|:&};:',
  // System modification
  'chmod 777 /',
  'chown -R',
  // Network attacks
  'wget | sh',
  'curl | sh',
  'wget | bash',
  'curl | bash',
  // Credential theft
  'cat /etc/shadow',
  'cat /etc/passwd',
  // Registry modification (Windows)
  'reg delete',
  'reg add HKLM',
] as const;

/**
 * Safe command allowlist
 */
export const SAFE_COMMANDS = [
  'ls',
  'dir',
  'pwd',
  'cd',
  'echo',
  'cat',
  'head',
  'tail',
  'grep',
  'find',
  'which',
  'where',
  'node',
  'npm',
  'npx',
  'yarn',
  'pnpm',
  'git',
  'python',
  'pip',
  'code',
] as const;
