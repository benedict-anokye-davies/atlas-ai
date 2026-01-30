/**
 * Atlas Desktop - Code Intelligence Types
 *
 * Types for codebase indexing, smart context building, and
 * iterative coding capabilities that enable Atlas to work
 * on its own codebase efficiently.
 *
 * @module code-intelligence/types
 */

// =============================================================================
// Symbol Types
// =============================================================================

/**
 * Types of symbols that can be indexed
 */
export type SymbolKind =
  | 'class'
  | 'interface'
  | 'type'
  | 'function'
  | 'method'
  | 'property'
  | 'variable'
  | 'constant'
  | 'enum'
  | 'enumMember'
  | 'module'
  | 'namespace';

/**
 * A symbol in the codebase (function, class, variable, etc.)
 */
export interface CodeSymbol {
  /** Symbol name */
  name: string;
  /** Fully qualified name (e.g., "ClassName.methodName") */
  qualifiedName: string;
  /** Type of symbol */
  kind: SymbolKind;
  /** File containing this symbol */
  filePath: string;
  /** Line number (1-based) */
  line: number;
  /** Column number (1-based) */
  column: number;
  /** End line */
  endLine: number;
  /** End column */
  endColumn: number;
  /** JSDoc or comment documentation */
  documentation?: string;
  /** Type signature (for functions, variables) */
  signature?: string;
  /** Whether this is exported */
  isExported: boolean;
  /** Whether this is the default export */
  isDefaultExport: boolean;
  /** Parent symbol (for methods, properties) */
  parent?: string;
  /** Modifiers (async, static, private, etc.) */
  modifiers: string[];
}

/**
 * An import statement
 */
export interface ImportInfo {
  /** File containing this import */
  filePath: string;
  /** Module being imported from */
  moduleSpecifier: string;
  /** Resolved path (if local) */
  resolvedPath?: string;
  /** Is this a type-only import */
  isTypeOnly: boolean;
  /** Named imports */
  namedImports: Array<{
    name: string;
    alias?: string;
    isType: boolean;
  }>;
  /** Default import name */
  defaultImport?: string;
  /** Namespace import name */
  namespaceImport?: string;
}

/**
 * An export statement
 */
export interface ExportInfo {
  /** File containing this export */
  filePath: string;
  /** Exported name */
  name: string;
  /** Local name (if different from exported) */
  localName?: string;
  /** Is this a type-only export */
  isTypeOnly: boolean;
  /** Is this a re-export */
  isReExport: boolean;
  /** Source module (for re-exports) */
  sourceModule?: string;
}

/**
 * A reference to a symbol
 */
export interface SymbolReference {
  /** Symbol being referenced */
  symbolName: string;
  /** File containing the reference */
  filePath: string;
  /** Line number */
  line: number;
  /** Column number */
  column: number;
  /** Context (surrounding code) */
  context: string;
  /** Type of reference */
  referenceKind: 'read' | 'write' | 'call' | 'type' | 'import' | 'export';
}

// =============================================================================
// Index Types
// =============================================================================

/**
 * File information in the index
 */
export interface IndexedFile {
  /** Absolute file path */
  path: string;
  /** Relative path from workspace root */
  relativePath: string;
  /** File extension */
  extension: string;
  /** Last modified timestamp */
  lastModified: number;
  /** Content hash for change detection */
  contentHash: string;
  /** Number of lines */
  lineCount: number;
  /** Symbols defined in this file */
  symbols: string[];
  /** Files this file imports from */
  imports: string[];
  /** Files that import from this file */
  importedBy: string[];
  /** Has parse errors */
  hasErrors: boolean;
  /** Parse error messages */
  errors?: string[];
}

/**
 * The complete codebase index
 */
export interface CodebaseIndex {
  /** Workspace root path */
  workspaceRoot: string;
  /** When the index was last updated */
  lastUpdated: number;
  /** Index version (for compatibility) */
  version: string;
  /** All indexed files */
  files: Map<string, IndexedFile>;
  /** All symbols by qualified name */
  symbols: Map<string, CodeSymbol>;
  /** Symbol name to qualified names (for lookup) */
  symbolNameIndex: Map<string, string[]>;
  /** All imports */
  imports: ImportInfo[];
  /** All exports */
  exports: ExportInfo[];
  /** All references */
  references: Map<string, SymbolReference[]>;
  /** Index statistics */
  stats: IndexStats;
}

/**
 * Index statistics
 */
export interface IndexStats {
  totalFiles: number;
  totalSymbols: number;
  totalImports: number;
  totalExports: number;
  totalReferences: number;
  indexTimeMs: number;
  filesWithErrors: number;
}

// =============================================================================
// Context Building Types
// =============================================================================

/**
 * Context relevance score
 */
export interface RelevanceScore {
  /** Overall relevance (0-1) */
  score: number;
  /** Breakdown of factors */
  factors: {
    /** Direct import/export relationship */
    importRelation: number;
    /** Symbol reference relationship */
    symbolReference: number;
    /** File proximity (same directory) */
    proximity: number;
    /** Naming similarity */
    namingSimilarity: number;
    /** Recent edit history */
    recentEdit: number;
  };
}

/**
 * A file with context relevance
 */
export interface RelevantFile {
  /** File path */
  path: string;
  /** Relevance score */
  relevance: RelevanceScore;
  /** Why this file is relevant */
  reason: string;
  /** Key symbols in this file */
  keySymbols: string[];
  /** Estimated token count */
  tokenEstimate: number;
}

/**
 * Built context for a task
 */
export interface TaskContext {
  /** Primary files to focus on */
  primaryFiles: RelevantFile[];
  /** Supporting files for reference */
  supportingFiles: RelevantFile[];
  /** Relevant symbols */
  relevantSymbols: CodeSymbol[];
  /** Related type definitions */
  typeDefinitions: CodeSymbol[];
  /** Total estimated tokens */
  totalTokens: number;
  /** Context was truncated */
  wasTruncated: boolean;
}

/**
 * Options for building context
 */
export interface ContextBuildOptions {
  /** Maximum total tokens */
  maxTokens?: number;
  /** Maximum files to include */
  maxFiles?: number;
  /** Include type definitions */
  includeTypes?: boolean;
  /** Include test files */
  includeTests?: boolean;
  /** Specific files to always include */
  alwaysInclude?: string[];
  /** Files to exclude */
  exclude?: string[];
}

// =============================================================================
// Iterative Coding Types
// =============================================================================

/**
 * A code change to apply
 */
export interface CodeChange {
  /** File to modify */
  filePath: string;
  /** Type of change */
  changeType: 'create' | 'modify' | 'delete' | 'rename';
  /** New file path (for rename) */
  newPath?: string;
  /** For modify: old content to replace */
  oldContent?: string;
  /** For modify/create: new content */
  newContent?: string;
  /** Description of the change */
  description: string;
  /** Line range affected */
  lineRange?: { start: number; end: number };
}

/**
 * Result of applying a change
 */
export interface ChangeResult {
  /** Whether the change succeeded */
  success: boolean;
  /** The change that was applied */
  change: CodeChange;
  /** Error message if failed */
  error?: string;
  /** Validation errors after change */
  validationErrors?: ValidationError[];
  /** Whether auto-fix was attempted */
  autoFixAttempted?: boolean;
}

/**
 * A validation error (from typecheck, lint, etc.)
 */
export interface ValidationError {
  /** File path */
  filePath: string;
  /** Line number */
  line: number;
  /** Column number */
  column: number;
  /** Error message */
  message: string;
  /** Error code (TS2304, etc.) */
  code?: string;
  /** Severity */
  severity: 'error' | 'warning' | 'info';
  /** Source (typescript, eslint, etc.) */
  source: string;
  /** Suggested fix */
  suggestedFix?: string;
}

/**
 * Iterative coding session state
 */
export interface CodingSession {
  /** Session ID */
  id: string;
  /** Task description */
  task: string;
  /** Files being modified */
  activeFiles: string[];
  /** Changes made so far */
  changes: ChangeResult[];
  /** Current validation state */
  validationState: {
    hasErrors: boolean;
    errorCount: number;
    warningCount: number;
    errors: ValidationError[];
  };
  /** Session started at */
  startedAt: number;
  /** Last activity */
  lastActivity: number;
}

// =============================================================================
// Project Rules Types
// =============================================================================

/**
 * Project-specific coding rules
 */
export interface ProjectRules {
  /** Code style rules */
  codeStyle: string[];
  /** Architecture patterns to follow */
  architecture: string[];
  /** Common patterns in this codebase */
  patterns: string[];
  /** Things to avoid */
  donts: string[];
  /** Naming conventions */
  naming?: {
    files?: string;
    classes?: string;
    functions?: string;
    variables?: string;
    constants?: string;
  };
  /** Import organization rules */
  imports?: {
    order?: string[];
    pathAliases?: Record<string, string>;
  };
  /** Testing conventions */
  testing?: {
    framework?: string;
    patterns?: string[];
    location?: string;
  };
}

// =============================================================================
// Tool Result Types
// =============================================================================

/**
 * Result of a find-symbol operation
 */
export interface FindSymbolResult {
  /** Found symbols */
  symbols: CodeSymbol[];
  /** Total matches (may be more than returned) */
  totalMatches: number;
  /** Search was truncated */
  truncated: boolean;
}

/**
 * Result of a find-references operation
 */
export interface FindReferencesResult {
  /** The symbol being referenced */
  symbol: CodeSymbol;
  /** All references found */
  references: SymbolReference[];
  /** Total references */
  totalReferences: number;
}

/**
 * Result of a go-to-definition operation
 */
export interface GoToDefinitionResult {
  /** Definition found */
  found: boolean;
  /** The symbol definition */
  symbol?: CodeSymbol;
  /** File path */
  filePath?: string;
  /** Line number */
  line?: number;
  /** Column number */
  column?: number;
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Code intelligence configuration
 */
export interface CodeIntelligenceConfig {
  /** Workspace root path */
  workspaceRoot: string;
  /** File patterns to include */
  includePatterns: string[];
  /** File patterns to exclude */
  excludePatterns: string[];
  /** Whether to watch for file changes */
  watchFiles: boolean;
  /** Index update debounce (ms) */
  updateDebounceMs: number;
  /** Maximum files to index */
  maxFiles: number;
  /** Maximum file size to index (bytes) */
  maxFileSize: number;
  /** Path aliases from tsconfig */
  pathAliases: Record<string, string>;
}

/**
 * Default configuration
 */
export const DEFAULT_CODE_INTELLIGENCE_CONFIG: CodeIntelligenceConfig = {
  workspaceRoot: '',
  includePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
  excludePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/coverage/**',
  ],
  watchFiles: true,
  updateDebounceMs: 1000,
  maxFiles: 5000,
  maxFileSize: 1024 * 1024, // 1MB
  pathAliases: {},
};
