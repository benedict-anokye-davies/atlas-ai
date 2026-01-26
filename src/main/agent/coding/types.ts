/**
 * @file Coding Agent Type Definitions
 * @description Comprehensive types for Atlas's autonomous coding capabilities
 */

// =============================================================================
// TOOL SYSTEM TYPES
// =============================================================================

/** Tool parameter definition */
export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  default?: unknown;
  enum?: string[];
  items?: { type: string };
}

/** Tool definition for the coding agent */
export interface CodingTool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  /** Whether this tool can modify the filesystem */
  dangerous: boolean;
  /** Maximum time for tool execution in ms */
  timeout?: number;
  /** Function to execute the tool */
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

/** Result from a tool execution */
export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  /** Structured data from tool */
  data?: unknown;
  /** Time taken in ms */
  duration?: number;
  /** Files affected */
  filesAffected?: string[];
  /** Whether the operation can be rolled back */
  canRollback?: boolean;
  /** Rollback function if applicable */
  rollback?: () => Promise<void>;
}

/** Tool call request from LLM */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Tool call with result */
export interface ToolCallWithResult extends ToolCall {
  result: ToolResult;
  startTime: number;
  endTime: number;
}

// =============================================================================
// CONTEXT TYPES
// =============================================================================

/** File information in context */
export interface FileContext {
  path: string;
  relativePath: string;
  content?: string;
  language: string;
  size: number;
  lastModified: Date;
  /** Line count */
  lines?: number;
  /** Symbols defined in this file */
  symbols?: SymbolInfo[];
  /** Import/export relationships */
  dependencies?: string[];
  dependents?: string[];
}

/** Symbol information (function, class, variable, etc.) */
export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  location: {
    file: string;
    startLine: number;
    endLine: number;
    startColumn?: number;
    endColumn?: number;
  };
  signature?: string;
  documentation?: string;
  /** For functions: parameter info */
  parameters?: ParameterInfo[];
  /** For functions: return type */
  returnType?: string;
  /** Parent symbol (e.g., class for methods) */
  parent?: string;
  /** Visibility */
  visibility?: 'public' | 'private' | 'protected' | 'internal';
}

export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'variable'
  | 'constant'
  | 'enum'
  | 'method'
  | 'property'
  | 'constructor'
  | 'namespace'
  | 'module';

export interface ParameterInfo {
  name: string;
  type?: string;
  optional?: boolean;
  defaultValue?: string;
}

/** Project-level context */
export interface ProjectContext {
  /** Root directory */
  root: string;
  /** Project name from package.json */
  name?: string;
  /** Primary language */
  language: 'typescript' | 'javascript' | 'python' | 'rust' | 'go' | 'other';
  /** Framework detected */
  framework?: string;
  /** Package manager */
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun';
  /** Key configuration files */
  configFiles: string[];
  /** Source directories */
  sourceDirs: string[];
  /** Test directories */
  testDirs: string[];
  /** Build output directories */
  outputDirs: string[];
  /** Ignore patterns (from .gitignore, etc.) */
  ignorePatterns: string[];
}

/** Full coding context */
export interface CodingContext {
  project: ProjectContext;
  /** Currently relevant files */
  activeFiles: FileContext[];
  /** Recently edited files */
  recentFiles: string[];
  /** Current errors in workspace */
  errors: CodeError[];
  /** Git status */
  gitStatus?: GitStatus;
  /** Search results if applicable */
  searchResults?: SearchResult[];
  /** Terminal output if applicable */
  terminalOutput?: string;
  /** User's original request */
  userRequest: string;
  /** Conversation history for this coding session */
  conversationHistory: ConversationMessage[];
}

/** Code error from TypeScript, linter, etc. */
export interface CodeError {
  file: string;
  line: number;
  column?: number;
  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  source?: string;
  code?: string | number;
  /** Suggested fixes */
  fixes?: CodeFix[];
}

export interface CodeFix {
  description: string;
  changes: FileEdit[];
}

/** Git repository status */
export interface GitStatus {
  branch: string;
  clean: boolean;
  ahead: number;
  behind: number;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

/** Search result */
export interface SearchResult {
  file: string;
  line: number;
  column?: number;
  content: string;
  matchLength: number;
  context?: {
    before: string[];
    after: string[];
  };
}

// =============================================================================
// EDIT ENGINE TYPES
// =============================================================================

/** A single file edit operation */
export interface FileEdit {
  file: string;
  type: 'create' | 'modify' | 'delete' | 'rename';
  /** For modify: the search string to find */
  oldContent?: string;
  /** For modify/create: the new content */
  newContent?: string;
  /** For rename: new path */
  newPath?: string;
  /** Description of the edit */
  description?: string;
}

/** Edit validation result */
export interface EditValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** If the edit target was found (for modify) */
  targetFound?: boolean;
  /** Number of matches if multiple */
  matchCount?: number;
}

/** Edit application result */
export interface EditResult {
  success: boolean;
  file: string;
  error?: string;
  /** Original content for rollback */
  originalContent?: string;
  /** Diff of changes */
  diff?: string;
  /** Line numbers affected */
  linesAffected?: { start: number; end: number };
}

/** Batch edit result */
export interface BatchEditResult {
  success: boolean;
  edits: EditResult[];
  /** Number of successful edits */
  successCount: number;
  /** Number of failed edits */
  failureCount: number;
  /** All rollback functions */
  rollback?: () => Promise<void>;
}

// =============================================================================
// AGENT TYPES
// =============================================================================

/** Agent state */
export type AgentState =
  | 'idle'
  | 'thinking'
  | 'executing'
  | 'waiting-for-tool'
  | 'error'
  | 'complete';

/** Conversation message */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** For tool messages */
  toolCallId?: string;
  /** Tool calls from assistant */
  toolCalls?: ToolCall[];
  timestamp: number;
}

/** Agent configuration */
export interface CodingAgentConfig {
  /** Maximum iterations before stopping */
  maxIterations: number;
  /** Maximum tokens per response */
  maxTokens: number;
  /** Temperature for LLM */
  temperature: number;
  /** Model to use */
  model: string;
  /** Whether to stream responses */
  streaming: boolean;
  /** Whether to auto-fix errors */
  autoFix: boolean;
  /** Whether to run tests after changes */
  runTests: boolean;
  /** Whether to require confirmation for dangerous operations */
  requireConfirmation: boolean;
  /** Timeout for entire task in ms */
  taskTimeout: number;
  /** Tools enabled for this session */
  enabledTools: string[];
}

/** Agent session */
export interface CodingSession {
  id: string;
  startTime: number;
  endTime?: number;
  state: AgentState;
  config: CodingAgentConfig;
  context: CodingContext;
  /** All messages in this session */
  messages: ConversationMessage[];
  /** All tool calls made */
  toolCalls: ToolCallWithResult[];
  /** Files modified in this session */
  filesModified: string[];
  /** Errors encountered */
  errors: string[];
  /** Whether the task was successful */
  success?: boolean;
  /** Summary of what was done */
  summary?: string;
}

/** Request to the coding agent */
export interface CodingRequest {
  /** The user's request in natural language */
  prompt: string;
  /** Optional context files to include */
  files?: string[];
  /** Whether to continue from previous session */
  continueSession?: string;
  /** Override default config */
  config?: Partial<CodingAgentConfig>;
}

/** Streaming response chunk */
export interface CodingResponseChunk {
  type: 'text' | 'tool-call' | 'tool-result' | 'thinking' | 'error' | 'complete';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  state?: AgentState;
  /** Progress indicator 0-100 */
  progress?: number;
}

/** Final agent response */
export interface CodingResponse {
  success: boolean;
  sessionId: string;
  message: string;
  /** Files that were created/modified/deleted */
  changes: FileEdit[];
  /** Errors encountered */
  errors: string[];
  /** Tool calls made */
  toolCallCount: number;
  /** Total time taken */
  duration: number;
  /** Summary of changes */
  summary: string;
}

// =============================================================================
// VOICE COMMAND TYPES
// =============================================================================

/** Parsed voice command */
export interface VoiceCommand {
  /** Original transcription */
  raw: string;
  /** Detected intent */
  intent: CodingIntent;
  /** Confidence score 0-1 */
  confidence: number;
  /** Extracted entities */
  entities: CommandEntities;
  /** Suggested clarifications if ambiguous */
  clarifications?: string[];
}

/** Coding intent categories */
export type CodingIntent =
  | 'create-file'
  | 'edit-file'
  | 'delete-file'
  | 'rename-file'
  | 'search-code'
  | 'find-symbol'
  | 'fix-errors'
  | 'run-command'
  | 'run-tests'
  | 'explain-code'
  | 'refactor'
  | 'add-feature'
  | 'debug'
  | 'commit'
  | 'unknown';

/** Entities extracted from voice command */
export interface CommandEntities {
  /** File paths mentioned */
  files?: string[];
  /** Symbol names (functions, classes, etc.) */
  symbols?: string[];
  /** Search queries */
  queries?: string[];
  /** Commands to run */
  commands?: string[];
  /** Languages or frameworks */
  languages?: string[];
  /** Numbers (line numbers, counts, etc.) */
  numbers?: number[];
  /** Quoted strings */
  quotedStrings?: string[];
}

// =============================================================================
// DIFF TYPES
// =============================================================================

/** Unified diff hunk */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

/** Single diff line */
export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

/** File diff */
export interface FileDiff {
  oldPath: string;
  newPath: string;
  type: 'add' | 'delete' | 'modify' | 'rename';
  hunks: DiffHunk[];
  /** Stats */
  additions: number;
  deletions: number;
}

// =============================================================================
// EVENTS
// =============================================================================

/** Events emitted by the coding agent */
export interface CodingAgentEvents {
  'session-start': (session: CodingSession) => void;
  'session-end': (session: CodingSession) => void;
  'state-change': (state: AgentState, session: CodingSession) => void;
  'message': (message: ConversationMessage) => void;
  'tool-call': (toolCall: ToolCall) => void;
  'tool-result': (result: ToolCallWithResult) => void;
  'file-change': (edit: FileEdit) => void;
  'error': (error: Error, session: CodingSession) => void;
  'progress': (progress: number, message: string) => void;
  'thinking': (thought: string) => void;
}

// =============================================================================
// DEFAULTS
// =============================================================================

/** Default agent configuration */
export const DEFAULT_CODING_CONFIG: CodingAgentConfig = {
  maxIterations: 25,
  maxTokens: 8192,
  temperature: 0.1,
  model: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
  streaming: true,
  autoFix: true,
  runTests: false,
  requireConfirmation: true,
  taskTimeout: 300000, // 5 minutes
  enabledTools: [
    'read_file',
    'edit_file',
    'create_file',
    'delete_file',
    'list_directory',
    'search_codebase',
    'grep_search',
    'find_symbol',
    'get_errors',
    'run_command',
    'git_status',
    'git_diff',
  ],
};

/** File extensions to language mapping */
export const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.cpp': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.sql': 'sql',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'zsh',
  '.ps1': 'powershell',
  '.dockerfile': 'dockerfile',
};

/** Ignore patterns for file traversal */
export const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  'coverage',
  '__pycache__',
  '.pytest_cache',
  'venv',
  '.venv',
  'target',
  '.idea',
  '.vscode',
  '*.log',
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];
