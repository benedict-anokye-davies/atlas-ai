/**
 * Atlas Desktop - Code Intelligence IPC Handlers
 *
 * IPC handlers that expose the code intelligence system to the renderer process.
 * These handlers enable the UI to interact with Atlas's self-coding capabilities.
 *
 * @module ipc/code-intelligence-handlers
 */

import { ipcMain, BrowserWindow } from 'electron';
import { createModuleLogger } from '../utils/logger';
import {
  initializeCodeIntelligence,
  getCodeIntelligenceStatus,
  shutdownCodeIntelligence,
  getCodebaseIndexer,
  getSmartContextBuilder,
  getIterativeCoder,
} from '../code-intelligence';
import type { SymbolKind, CodeChange } from '../code-intelligence/types';

const logger = createModuleLogger('CodeIntelligenceIPC');

// Track main window for event forwarding
let mainWindow: BrowserWindow | null = null;

/**
 * Set the main window for event forwarding
 */
export function setCodeIntelligenceMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

/**
 * Send event to renderer if window exists
 */
function sendToRenderer(channel: string, data?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

/**
 * IPCResult interface for consistent response format
 */
interface IPCResult<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

/**
 * Register all code intelligence IPC handlers
 */
export function registerCodeIntelligenceHandlers(): void {
  logger.info('Registering code intelligence IPC handlers');

  // ==========================================================================
  // Status & Initialization
  // ==========================================================================

  /**
   * Get code intelligence status
   */
  ipcMain.handle('code-intelligence:get-status', async (): Promise<IPCResult> => {
    try {
      const status = getCodeIntelligenceStatus();
      return { success: true, data: status };
    } catch (error) {
      logger.error('Failed to get status', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  /**
   * Initialize code intelligence (if not already initialized)
   */
  ipcMain.handle(
    'code-intelligence:initialize',
    async (_event, workspaceRoot?: string): Promise<IPCResult> => {
      try {
        await initializeCodeIntelligence(workspaceRoot);
        
        // Set up event forwarding
        const indexer = getCodebaseIndexer();
        indexer.on('indexing-progress', (progress) => {
          sendToRenderer('code-intelligence:indexing-progress', progress);
        });
        indexer.on('indexing-complete', (stats) => {
          sendToRenderer('code-intelligence:indexing-complete', stats);
        });

        return { success: true, data: getCodeIntelligenceStatus() };
      } catch (error) {
        logger.error('Failed to initialize', { error });
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  /**
   * Shutdown code intelligence
   */
  ipcMain.handle('code-intelligence:shutdown', async (): Promise<IPCResult> => {
    try {
      shutdownCodeIntelligence();
      return { success: true };
    } catch (error) {
      logger.error('Failed to shutdown', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // ==========================================================================
  // Symbol Operations
  // ==========================================================================

  /**
   * Find a symbol by name
   */
  ipcMain.handle(
    'code-intelligence:find-symbol',
    async (
      _event,
      name: string,
      kind?: SymbolKind
    ): Promise<IPCResult> => {
      try {
        const indexer = getCodebaseIndexer();
        if (!indexer.isReady()) {
          return {
            success: false,
            error: 'Codebase index not ready. Please wait for indexing to complete.',
          };
        }

        const symbols = indexer.findSymbol(name, kind);
        return {
          success: true,
          data: {
            found: symbols.length > 0,
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
      } catch (error) {
        logger.error('Failed to find symbol', { error, name });
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  /**
   * Find all references to a symbol
   */
  ipcMain.handle(
    'code-intelligence:find-references',
    async (_event, symbolName: string): Promise<IPCResult> => {
      try {
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
      } catch (error) {
        logger.error('Failed to find references', { error, symbolName });
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  /**
   * Go to definition of a symbol
   */
  ipcMain.handle(
    'code-intelligence:go-to-definition',
    async (_event, symbolName: string): Promise<IPCResult> => {
      try {
        const indexer = getCodebaseIndexer();
        if (!indexer.isReady()) {
          return {
            success: false,
            error: 'Codebase index not ready',
          };
        }

        const location = indexer.goToDefinition(symbolName);
        if (!location) {
          return {
            success: true,
            data: { found: false },
          };
        }

        return {
          success: true,
          data: {
            found: true,
            ...location,
          },
        };
      } catch (error) {
        logger.error('Failed to go to definition', { error, symbolName });
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // ==========================================================================
  // Context Building
  // ==========================================================================

  /**
   * Build context for a coding task
   */
  ipcMain.handle(
    'code-intelligence:build-context',
    async (
      _event,
      task: string,
      options?: { maxFiles?: number; maxTokens?: number }
    ): Promise<IPCResult> => {
      try {
        const contextBuilder = getSmartContextBuilder();
        const context = await contextBuilder.buildContext(task, options);

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
            totalTokens: context.totalTokens,
            wasTruncated: context.wasTruncated,
          },
        };
      } catch (error) {
        logger.error('Failed to build context', { error, task });
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // ==========================================================================
  // Coding Sessions
  // ==========================================================================

  /**
   * Start a coding session
   */
  ipcMain.handle(
    'code-intelligence:start-session',
    async (_event, task: string): Promise<IPCResult> => {
      try {
        const coder = getIterativeCoder();
        const session = coder.startSession(task);

        sendToRenderer('code-intelligence:session-started', {
          sessionId: session.id,
          task: session.task,
        });

        return {
          success: true,
          data: {
            sessionId: session.id,
            task: session.task,
          },
        };
      } catch (error) {
        logger.error('Failed to start session', { error, task });
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  /**
   * Get active session status
   */
  ipcMain.handle('code-intelligence:get-session', async (): Promise<IPCResult> => {
    try {
      const coder = getIterativeCoder();
      const session = coder.getActiveSession();

      if (!session) {
        return {
          success: true,
          data: { hasSession: false },
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
          validationState: session.validationState,
          duration: Date.now() - session.startedAt,
        },
      };
    } catch (error) {
      logger.error('Failed to get session', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  /**
   * Apply a code change
   */
  ipcMain.handle(
    'code-intelligence:apply-change',
    async (_event, change: CodeChange): Promise<IPCResult> => {
      try {
        const coder = getIterativeCoder();
        const session = coder.getActiveSession();

        if (!session) {
          return {
            success: false,
            error: 'No active coding session. Start one first.',
          };
        }

        const result = await coder.applyChange(change);

        // Forward change event to renderer
        sendToRenderer('code-intelligence:change-applied', {
          filePath: change.filePath,
          changeType: change.changeType,
          success: result.success,
          hasErrors: result.validationErrors?.some((e) => e.severity === 'error'),
        });

        return {
          success: result.success,
          error: result.error,
          data: result.success
            ? {
                hasValidationErrors: result.validationErrors?.some(
                  (e) => e.severity === 'error'
                ),
                errors: result.validationErrors
                  ?.filter((e) => e.severity === 'error')
                  .slice(0, 10),
                warnings: result.validationErrors
                  ?.filter((e) => e.severity === 'warning')
                  .slice(0, 5),
              }
            : undefined,
        };
      } catch (error) {
        logger.error('Failed to apply change', { error, filePath: change.filePath });
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  /**
   * Validate the codebase
   */
  ipcMain.handle(
    'code-intelligence:validate',
    async (_event, quickCheck?: boolean): Promise<IPCResult> => {
      try {
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

        // Forward validation result to renderer
        sendToRenderer('code-intelligence:validation-complete', {
          valid: errorCount === 0,
          errorCount,
          warningCount,
        });

        return {
          success: true,
          data: {
            valid: errorCount === 0,
            errorCount,
            warningCount,
            errors: errors.filter((e) => e.severity === 'error').slice(0, 20),
            warnings: errors.filter((e) => e.severity === 'warning').slice(0, 10),
          },
        };
      } catch (error) {
        logger.error('Failed to validate', { error });
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  /**
   * Revert the last change
   */
  ipcMain.handle('code-intelligence:revert-last', async (): Promise<IPCResult> => {
    try {
      const coder = getIterativeCoder();
      const reverted = await coder.revertLastChange();

      if (reverted) {
        sendToRenderer('code-intelligence:change-reverted', {});
      }

      return {
        success: true,
        data: {
          reverted,
          message: reverted ? 'Last change reverted' : 'No change to revert',
        },
      };
    } catch (error) {
      logger.error('Failed to revert', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  /**
   * End the coding session
   */
  ipcMain.handle(
    'code-intelligence:end-session',
    async (_event, sessionId?: string): Promise<IPCResult> => {
      try {
        const coder = getIterativeCoder();
        const session = coder.getActiveSession();

        if (!session) {
          return {
            success: true,
            data: { message: 'No active session' },
          };
        }

        const summary = {
          task: session.task,
          changesCount: session.changes.length,
          successfulChanges: session.changes.filter((c) => c.success).length,
          duration: Date.now() - session.startedAt,
        };

        coder.endSession(sessionId || session.id);

        sendToRenderer('code-intelligence:session-ended', summary);

        return {
          success: true,
          data: { summary },
        };
      } catch (error) {
        logger.error('Failed to end session', { error });
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // ==========================================================================
  // Index Management
  // ==========================================================================

  /**
   * Rebuild the codebase index
   */
  ipcMain.handle('code-intelligence:rebuild-index', async (): Promise<IPCResult> => {
    try {
      const indexer = getCodebaseIndexer();
      
      sendToRenderer('code-intelligence:indexing-started', {});
      
      await indexer.buildIndex();
      
      return {
        success: true,
        data: getCodeIntelligenceStatus(),
      };
    } catch (error) {
      logger.error('Failed to rebuild index', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  /**
   * Get index statistics
   */
  ipcMain.handle('code-intelligence:get-index-stats', async (): Promise<IPCResult> => {
    try {
      const indexer = getCodebaseIndexer();
      if (!indexer.isReady()) {
        return {
          success: true,
          data: { ready: false },
        };
      }

      const index = indexer.getIndex();
      if (!index) {
        return {
          success: true,
          data: { ready: false },
        };
      }

      return {
        success: true,
        data: {
          ready: true,
          fileCount: index.files.size,
          symbolCount: index.symbols.size,
          referenceCount: index.references.size,
          stats: index.stats,
        },
      };
    } catch (error) {
      logger.error('Failed to get index stats', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  logger.info('Code intelligence IPC handlers registered');
}

/**
 * Unregister all code intelligence IPC handlers
 */
export function unregisterCodeIntelligenceHandlers(): void {
  const channels = [
    'code-intelligence:get-status',
    'code-intelligence:initialize',
    'code-intelligence:shutdown',
    'code-intelligence:find-symbol',
    'code-intelligence:find-references',
    'code-intelligence:go-to-definition',
    'code-intelligence:build-context',
    'code-intelligence:start-session',
    'code-intelligence:get-session',
    'code-intelligence:apply-change',
    'code-intelligence:validate',
    'code-intelligence:revert-last',
    'code-intelligence:end-session',
    'code-intelligence:rebuild-index',
    'code-intelligence:get-index-stats',
  ];

  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  logger.info('Code intelligence IPC handlers unregistered');
}
