/**
 * Atlas Desktop - Code Intelligence Tools
 *
 * Agent tools that expose the code intelligence system to the LLM.
 * These tools enable Atlas to understand and modify its own codebase.
 *
 * @module code-intelligence/tools
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { getCodebaseIndexer } from './codebase-indexer';
import { getSmartContextBuilder } from './context-builder';
import { getIterativeCoder } from './iterative-coder';
import type { AgentTool } from '../../shared/types/agent';
import type { CodeChange, SymbolKind } from './types';

// =============================================================================
// Tool Definitions
// =============================================================================
/**
 * Find a symbol (function, class, variable) in the codebase
 */
export const findSymbolTool: AgentTool = {
  name: 'code_find_symbol',
  description:
    'Find a symbol (function, class, interface, variable, type) in the codebase. ' +
    'Returns the file path, line number, and definition. ' +
    'Use this to locate where something is defined before modifying it.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The name of the symbol to find (e.g., "VoicePipeline", "createModuleLogger")',
      },
      kind: {
        type: 'string',
        enum: ['function', 'class', 'interface', 'variable', 'type', 'enum', 'method'],
        description: 'Optional: Filter by symbol type',
      },
    },
    required: ['name'],
  },
  execute: async (params: Record<string, unknown>) => {
    const { name, kind } = params as { name: string; kind?: SymbolKind };

    const indexer = getCodebaseIndexer();
    if (!indexer.isReady()) {
      return {
        success: false,
        error: 'Codebase index not ready. Please wait for indexing to complete.',
      };
    }

    const symbols = indexer.findSymbol(name, kind);
    if (symbols.length === 0) {
      return {
        success: true,
        data: {
          found: false,
          message: `No symbol named "${name}" found in the codebase`,
        },
      };
    }

    return {
      success: true,
      data: {
        found: true,
        count: symbols.length,
        symbols: symbols.map((s) => ({
          name: s.name,
          kind: s.kind,
          file: s.filePath,
          line: s.line,
          exported: s.isExported,
          signature: s.signature,
          documentation: s.documentation,
        })),
      },
    };
  },
};

/**
 * Find all references to a symbol
 */
export const findReferencesTool: AgentTool = {
  name: 'code_find_references',
  description:
    'Find all places where a symbol (function, class, etc.) is used. ' +
    'Returns file paths and line numbers. ' +
    'Use this before renaming or modifying a function to understand its impact.',
  parameters: {
    type: 'object',
    properties: {
      symbolName: {
        type: 'string',
        description: 'The name of the symbol to find references for',
      },
    },
    required: ['symbolName'],
  },
  execute: async (params: Record<string, unknown>) => {
    const { symbolName } = params as { symbolName: string };

    const indexer = getCodebaseIndexer();
    if (!indexer.isReady()) {
      return {
        success: false,
        error: 'Codebase index not ready',
      };
    }

    const references = indexer.findReferences(symbolName);
    return {
      success: true,
      data: {
        symbolName,
        referenceCount: references.length,
        references: references.map((r) => ({
          file: r.filePath,
          line: r.line,
          context: r.context,
        })),
      },
    };
  },
};

/**
 * Get context for a coding task
 */
export const getContextTool: AgentTool = {
  name: 'code_get_context',
  description:
    'Automatically find relevant files and code for a task. ' +
    'Given a description of what you want to do, this tool finds the files, ' +
    'symbols, and code snippets you\'ll need. ' +
    'Use this at the start of any coding task to gather context.',
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Description of the coding task (e.g., "add error handling to the voice pipeline")',
      },
      maxFiles: {
        type: 'number',
        description: 'Maximum number of files to include (default: 10)',
      },
      maxTokens: {
        type: 'number',
        description: 'Maximum token budget for context (default: 8000)',
      },
    },
    required: ['task'],
  },
  execute: async (params: Record<string, unknown>) => {
    const { task, maxFiles = 10, maxTokens = 8000 } = params as {
      task: string;
      maxFiles?: number;
      maxTokens?: number;
    };

    const contextBuilder = getSmartContextBuilder();
    const context = await contextBuilder.buildContext(task, {
      maxFiles,
      maxTokens,
    });

    // Combine primary and supporting files
    const allFiles = [...context.primaryFiles, ...context.supportingFiles];

    return {
      success: true,
      data: {
        task,
        primaryFiles: context.primaryFiles.map((f) => ({
          path: f.path,
          relevanceScore: f.relevance.score,
          reason: f.reason,
        })),
        supportingFiles: context.supportingFiles.map((f) => ({
          path: f.path,
          relevanceScore: f.relevance.score,
          reason: f.reason,
        })),
        totalEstimatedTokens: context.totalTokens,
        wasTruncated: context.wasTruncated,
        summary:
          `Found ${allFiles.length} relevant files. ` +
          `Primary: ${context.primaryFiles.slice(0, 3).map((f) => path.basename(f.path)).join(', ')}`,
      },
    };
  },
};

/**
 * Start a coding session
 */
export const startCodingSessionTool: AgentTool = {
  name: 'code_start_session',
  description:
    'Start a new coding session for a task. ' +
    'This enables change tracking, validation, and undo. ' +
    'Always start a session before making code changes.',
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Description of what you\'re trying to accomplish',
      },
    },
    required: ['task'],
  },
  execute: async (params: Record<string, unknown>) => {
    const { task } = params as { task: string };

    const coder = getIterativeCoder();
    const session = coder.startSession(task);

    return {
      success: true,
      data: {
        sessionId: session.id,
        task: session.task,
        message: 'Coding session started. Make changes with code_apply_change and validate with code_validate.',
      },
    };
  },
};

/**
 * Apply a code change
 */
export const applyChangeTool: AgentTool = {
  name: 'code_apply_change',
  description:
    'Apply a code change to a file. Automatically validates and reports errors. ' +
    'For modify: provide the exact text to replace (oldContent) and what to replace it with (newContent). ' +
    'For create: provide the file path and content. ' +
    'For delete: provide the file path.',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Path to the file (relative to project root)',
      },
      changeType: {
        type: 'string',
        enum: ['create', 'modify', 'delete'],
        description: 'Type of change',
      },
      oldContent: {
        type: 'string',
        description: 'For modify: the exact text to replace (include surrounding context)',
      },
      newContent: {
        type: 'string',
        description: 'For create/modify: the new content',
      },
      description: {
        type: 'string',
        description: 'Brief description of the change',
      },
    },
    required: ['filePath', 'changeType', 'description'],
  },
  execute: async (params: Record<string, unknown>) => {
    const { filePath, changeType, oldContent, newContent, description } = params as {
      filePath: string;
      changeType: 'create' | 'modify' | 'delete';
      oldContent?: string;
      newContent?: string;
      description: string;
    };

    const coder = getIterativeCoder();
    const session = coder.getActiveSession();

    if (!session) {
      return {
        success: false,
        error: 'No active coding session. Start one with code_start_session first.',
      };
    }

    const change: CodeChange = {
      filePath,
      changeType,
      oldContent,
      newContent,
      description,
    };

    const result = await coder.applyChange(change);

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Change failed',
      };
    }

    const hasErrors = result.validationErrors?.some((e) => e.severity === 'error');
    return {
      success: true,
      data: {
        changeApplied: true,
        hasValidationErrors: hasErrors,
        errorCount: result.validationErrors?.filter((e) => e.severity === 'error').length || 0,
        errors: result.validationErrors
          ?.filter((e) => e.severity === 'error')
          .slice(0, 5)
          .map((e) => ({
            file: e.filePath,
            line: e.line,
            message: e.message,
          })),
        warnings: result.validationErrors
          ?.filter((e) => e.severity === 'warning')
          .slice(0, 3)
          .map((e) => ({
            file: e.filePath,
            line: e.line,
            message: e.message,
          })),
      },
    };
  },
};

/**
 * Validate the codebase
 */
export const validateCodeTool: AgentTool = {
  name: 'code_validate',
  description:
    'Run TypeScript type checking on the codebase. ' +
    'Returns any compilation errors or warnings. ' +
    'Use this after making changes to verify they compile.',
  parameters: {
    type: 'object',
    properties: {
      quickCheck: {
        type: 'boolean',
        description: 'If true, only check the active session files (faster)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>) => {
    const { quickCheck = false } = params as { quickCheck?: boolean };

    const coder = getIterativeCoder();
    const session = coder.getActiveSession();

    let errors;
    if (quickCheck && session?.activeFiles.length) {
      errors = await coder.quickValidate(session.activeFiles);
    } else {
      errors = await coder.validate();
    }

    const errorCount = errors.filter((e) => e.severity === 'error').length;
    const warningCount = errors.filter((e) => e.severity === 'warning').length;

    return {
      success: true,
      data: {
        valid: errorCount === 0,
        errorCount,
        warningCount,
        errors: errors
          .filter((e) => e.severity === 'error')
          .slice(0, 10)
          .map((e) => ({
            file: path.basename(e.filePath),
            line: e.line,
            message: e.message,
            code: e.code,
          })),
        warnings: errors
          .filter((e) => e.severity === 'warning')
          .slice(0, 5)
          .map((e) => ({
            file: path.basename(e.filePath),
            line: e.line,
            message: e.message,
          })),
      },
    };
  },
};

/**
 * Revert the last change
 */
export const revertChangeTool: AgentTool = {
  name: 'code_revert_last',
  description:
    'Undo the last code change. ' +
    'Use this if a change introduced errors you can\'t fix.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async () => {
    const coder = getIterativeCoder();
    const reverted = await coder.revertLastChange();

    return {
      success: true,
      data: {
        reverted,
        message: reverted
          ? 'Last change reverted successfully'
          : 'No change to revert',
      },
    };
  },
};

/**
 * End the coding session
 */
export const endCodingSessionTool: AgentTool = {
  name: 'code_end_session',
  description:
    'End the current coding session. ' +
    'Call this when you\'re done making changes.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async () => {
    const coder = getIterativeCoder();
    const session = coder.getActiveSession();

    if (!session) {
      return {
        success: true,
        data: { message: 'No active session to end' },
      };
    }

    const summary = {
      task: session.task,
      changesCount: session.changes.length,
      successfulChanges: session.changes.filter((c) => c.success).length,
      duration: Date.now() - session.startedAt,
      finalValidationState: session.validationState,
    };

    coder.endSession(session.id);

    return {
      success: true,
      data: {
        message: 'Coding session ended',
        summary,
      },
    };
  },
};

/**
 * Read a file with context
 */
export const readFileWithContextTool: AgentTool = {
  name: 'code_read_file',
  description:
    'Read a file from the codebase. ' +
    'Returns the content along with symbol information. ' +
    'Use this instead of the regular read_file for code files.',
  parameters: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Path to the file (relative to project root)',
      },
      lineStart: {
        type: 'number',
        description: 'Optional: start line (1-based)',
      },
      lineEnd: {
        type: 'number',
        description: 'Optional: end line (1-based)',
      },
    },
    required: ['filePath'],
  },
  execute: async (params: Record<string, unknown>) => {
    const { filePath, lineStart, lineEnd } = params as {
      filePath: string;
      lineStart?: number;
      lineEnd?: number;
    };

    const workspaceRoot = process.cwd();
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(workspaceRoot, filePath);

    try {
      const content = await fs.readFile(absolutePath, 'utf-8');
      const lines = content.split('\n');

      // Get line range
      const start = lineStart ? lineStart - 1 : 0;
      const end = lineEnd ? lineEnd : lines.length;
      const selectedLines = lines.slice(start, end);

      // Get symbols in this file
      const indexer = getCodebaseIndexer();
      const symbols: { name: string; kind: string; line: number }[] = [];

      if (indexer.isReady()) {
        const index = indexer.getIndex();
        const fileInfo = index?.files.get(absolutePath);
        if (fileInfo && index) {
          // fileInfo.symbols contains qualified names - look them up
          for (const symbolName of fileInfo.symbols) {
            const symbol = index.symbols.get(symbolName);
            if (symbol) {
              symbols.push({
                name: symbol.name,
                kind: symbol.kind,
                line: symbol.line,
              });
            }
          }
        }
      }

      return {
        success: true,
        data: {
          filePath: absolutePath,
          lineRange: { start: start + 1, end },
          totalLines: lines.length,
          content: selectedLines.join('\n'),
          symbols: symbols.slice(0, 20),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

/**
 * Get session status
 */
export const getSessionStatusTool: AgentTool = {
  name: 'code_session_status',
  description:
    'Get the current coding session status. ' +
    'Shows active files, changes made, and validation state.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async () => {
    const coder = getIterativeCoder();
    const session = coder.getActiveSession();

    if (!session) {
      return {
        success: true,
        data: {
          hasSession: false,
          message: 'No active coding session',
        },
      };
    }

    return {
      success: true,
      data: {
        hasSession: true,
        sessionId: session.id,
        task: session.task,
        activeFiles: session.activeFiles,
        changesCount: session.changes.length,
        successfulChanges: session.changes.filter((c) => c.success).length,
        failedChanges: session.changes.filter((c) => !c.success).length,
        validationState: {
          hasErrors: session.validationState.hasErrors,
          errorCount: session.validationState.errorCount,
          warningCount: session.validationState.warningCount,
        },
        duration: Date.now() - session.startedAt,
      },
    };
  },
};

// =============================================================================
// Tool Registration
// =============================================================================

/**
 * Get all code intelligence tools
 */
export function getCodeIntelligenceTools(): AgentTool[] {
  return [
    findSymbolTool,
    findReferencesTool,
    getContextTool,
    startCodingSessionTool,
    applyChangeTool,
    validateCodeTool,
    revertChangeTool,
    endCodingSessionTool,
    readFileWithContextTool,
    getSessionStatusTool,
  ];
}
