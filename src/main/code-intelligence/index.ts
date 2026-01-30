/**
 * Atlas Desktop - Code Intelligence Module
 *
 * This module provides Atlas with deep understanding of its own codebase,
 * enabling efficient self-improvement without relying on external tools.
 *
 * ## Features
 *
 * - **Codebase Indexing**: Index all symbols, imports, exports, and references
 * - **Smart Context Building**: Automatically find relevant files for any task
 * - **Iterative Coding**: Make changes with instant validation feedback
 * - **Agent Tools**: LLM-callable tools for code intelligence
 *
 * ## Usage
 *
 * ```typescript
 * import { initializeCodeIntelligence, getCodeIntelligenceTools } from './code-intelligence';
 *
 * // Initialize on app startup
 * await initializeCodeIntelligence('/path/to/atlas');
 *
 * // Get tools for the agent
 * const tools = getCodeIntelligenceTools();
 * ```
 *
 * @module code-intelligence
 */

import { createModuleLogger } from '../utils/logger';

// Import submodules
export * from './types';
export * from './codebase-indexer';
export * from './context-builder';
export * from './iterative-coder';
export * from './tools';

import { getCodebaseIndexer, resetCodebaseIndexer } from './codebase-indexer';
import { getSmartContextBuilder, resetSmartContextBuilder } from './context-builder';
import { getIterativeCoder, resetIterativeCoder } from './iterative-coder';
import { getCodeIntelligenceTools } from './tools';

const logger = createModuleLogger('CodeIntelligence');

// =============================================================================
// Module State
// =============================================================================

interface CodeIntelligenceState {
  initialized: boolean;
  workspaceRoot: string | null;
  indexingComplete: boolean;
}

const state: CodeIntelligenceState = {
  initialized: false,
  workspaceRoot: null,
  indexingComplete: false,
};

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize the code intelligence system
 *
 * @param workspaceRoot - Path to the project root (defaults to app directory)
 */
export async function initializeCodeIntelligence(
  workspaceRoot?: string
): Promise<void> {
  if (state.initialized) {
    logger.info('Code intelligence already initialized');
    return;
  }

  // Determine workspace root
  const root = workspaceRoot || process.cwd();
  state.workspaceRoot = root;

  logger.info('Initializing code intelligence', { workspaceRoot: root });

  try {
    // Initialize components by getting them with the workspace root
    // The indexer needs the workspace root in its config
    getCodebaseIndexer({ workspaceRoot: root });
    
    // Context builder gets the indexer automatically
    getSmartContextBuilder();
    
    // Iterative coder needs the workspace root
    getIterativeCoder(root);

    state.initialized = true;
    logger.info('Code intelligence initialized');

    // Start indexing in the background
    startBackgroundIndexing();
  } catch (error) {
    logger.error('Failed to initialize code intelligence', { error });
    throw error;
  }
}

/**
 * Start background indexing
 */
async function startBackgroundIndexing(): Promise<void> {
  try {
    const indexer = getCodebaseIndexer();

    indexer.on('indexing-complete', (stats) => {
      state.indexingComplete = true;
      logger.info('Codebase indexing complete', stats);
    });

    indexer.on('indexing-progress', (progress) => {
      logger.debug('Indexing progress', progress);
    });

    // Start indexing
    await indexer.buildIndex();
  } catch (error) {
    logger.error('Background indexing failed', { error });
  }
}

/**
 * Get the code intelligence status
 */
export function getCodeIntelligenceStatus(): {
  initialized: boolean;
  workspaceRoot: string | null;
  indexingComplete: boolean;
  indexStats: {
    fileCount: number;
    symbolCount: number;
  } | null;
} {
  let indexStats = null;

  if (state.initialized) {
    const indexer = getCodebaseIndexer();
    if (indexer.isReady()) {
      const index = indexer.getIndex();
      if (index) {
        indexStats = {
          fileCount: index.files.size,
          symbolCount: index.symbols.size,
        };
      }
    }
  }

  return {
    initialized: state.initialized,
    workspaceRoot: state.workspaceRoot,
    indexingComplete: state.indexingComplete,
    indexStats,
  };
}

/**
 * Shutdown the code intelligence system
 */
export function shutdownCodeIntelligence(): void {
  // Reset all singletons
  resetCodebaseIndexer();
  resetSmartContextBuilder();
  resetIterativeCoder();
  
  state.initialized = false;
  state.workspaceRoot = null;
  state.indexingComplete = false;
  logger.info('Code intelligence shut down');
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export { getCodeIntelligenceTools };
