/**
 * Atlas Intelligence Platform Manager
 * Main initialization and lifecycle management for the intelligence platform
 * 
 * A Palantir-style personal intelligence system providing:
 * - Unified ontology for all personal data
 * - Knowledge graph with relationship mapping
 * - Specialized AI agents (Trading, Project, Financial, Relationship, Research)
 * - Dynamic learning layer (patterns, predictions, behavioral models)
 * - Common Operating Picture (COP) for unified state view
 * - Automated playbooks for workflow automation
 * - Security layer with encryption and audit logging
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('IntelligencePlatform');

// ============================================================================
// INITIALIZATION STATE
// ============================================================================

interface IntelligencePlatformStatus {
  initialized: boolean;
  ontologyReady: boolean;
  semanticReady: boolean;
  entityResolutionReady: boolean;
  knowledgeGraphReady: boolean;
  temporalReady: boolean;
  agentsReady: boolean;
  dynamicLayerReady: boolean;
  copReady: boolean;
  playbooksReady: boolean;
  securityReady: boolean;
  ipcRegistered: boolean;
  startupTime?: number;
  error?: string;
}

let platformStatus: IntelligencePlatformStatus = {
  initialized: false,
  ontologyReady: false,
  semanticReady: false,
  entityResolutionReady: false,
  knowledgeGraphReady: false,
  temporalReady: false,
  agentsReady: false,
  dynamicLayerReady: false,
  copReady: false,
  playbooksReady: false,
  securityReady: false,
  ipcRegistered: false,
};

// ============================================================================
// INTELLIGENCE PLATFORM MANAGER
// ============================================================================

class IntelligencePlatformManager extends EventEmitter {
  private static instance: IntelligencePlatformManager;
  private initPromise: Promise<void> | null = null;

  private constructor() {
    super();
  }

  static getInstance(): IntelligencePlatformManager {
    if (!IntelligencePlatformManager.instance) {
      IntelligencePlatformManager.instance = new IntelligencePlatformManager();
    }
    return IntelligencePlatformManager.instance;
  }

  /**
   * Initialize all intelligence subsystems in dependency order
   */
  async initialize(): Promise<void> {
    // Prevent duplicate initialization
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    const startTime = Date.now();
    logger.info('Initializing Atlas Intelligence Platform...');

    try {
      // 1. Security first (needed for encryption)
      logger.info('Initializing security layer...');
      const { getSecurityManager } = await import('./security');
      const security = getSecurityManager();
      await security.initialize();
      platformStatus.securityReady = true;
      this.emit('module-ready', 'security');

      // 2. Ontology (database layer)
      logger.info('Initializing ontology store...');
      const { getOntologyStore, getEntityManager, getRelationshipManager } = await import('./ontology');
      const ontology = getOntologyStore();
      await ontology.initialize();
      platformStatus.ontologyReady = true;
      this.emit('module-ready', 'ontology');

      // Initialize entity and relationship managers (they depend on ontology)
      getEntityManager();
      getRelationshipManager();

      // 3. Semantic layer (parsers)
      logger.info('Initializing semantic layer...');
      const { getSemanticLayerManager } = await import('./semantic');
      const semantic = getSemanticLayerManager();
      await semantic.initialize();
      platformStatus.semanticReady = true;
      this.emit('module-ready', 'semantic');

      // 4. Entity resolution
      logger.info('Initializing entity resolution...');
      const { getEntityResolutionEngine } = await import('./entity-resolution');
      const entityRes = getEntityResolutionEngine();
      await entityRes.initialize();
      platformStatus.entityResolutionReady = true;
      this.emit('module-ready', 'entity-resolution');

      // 5. Knowledge graph
      logger.info('Initializing knowledge graph...');
      const { getKnowledgeGraphEngine } = await import('./knowledge-graph');
      const graph = getKnowledgeGraphEngine();
      await graph.initialize();
      platformStatus.knowledgeGraphReady = true;
      this.emit('module-ready', 'knowledge-graph');

      // 6. Temporal engine
      logger.info('Initializing temporal engine...');
      const { getTemporalEngine } = await import('./temporal');
      const temporal = getTemporalEngine();
      await temporal.initialize();
      platformStatus.temporalReady = true;
      this.emit('module-ready', 'temporal');

      // 7. Agents
      logger.info('Initializing intelligence agents...');
      const { getAgentRegistry } = await import('./agents');
      const registry = getAgentRegistry();
      await registry.initialize();
      platformStatus.agentsReady = true;
      this.emit('module-ready', 'agents');

      // 8. Dynamic layer (learning)
      logger.info('Initializing dynamic layer...');
      const { getDynamicLayerManager } = await import('./dynamic');
      const dynamic = getDynamicLayerManager();
      await dynamic.initialize();
      platformStatus.dynamicLayerReady = true;
      this.emit('module-ready', 'dynamic');

      // 9. COP (Common Operating Picture)
      logger.info('Initializing COP...');
      const { getCOPManager } = await import('./cop');
      const cop = getCOPManager();
      await cop.initialize();
      platformStatus.copReady = true;
      this.emit('module-ready', 'cop');

      // 10. Playbooks
      logger.info('Initializing playbooks...');
      const { getPlaybookManager } = await import('./playbooks');
      const playbooks = getPlaybookManager();
      await playbooks.initialize();
      platformStatus.playbooksReady = true;
      this.emit('module-ready', 'playbooks');

      // 11. Register IPC handlers
      logger.info('Registering IPC handlers...');
      const { registerIntelligenceIPC } = await import('./ipc');
      registerIntelligenceIPC();
      platformStatus.ipcRegistered = true;
      this.emit('module-ready', 'ipc');

      // Done
      platformStatus.initialized = true;
      platformStatus.startupTime = Date.now() - startTime;

      logger.info(`Atlas Intelligence Platform initialized in ${platformStatus.startupTime}ms`);
      this.emit('initialized', platformStatus);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      platformStatus.error = errorMessage;
      logger.error('Failed to initialize intelligence platform:', error as Record<string, unknown>);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Shutdown all intelligence subsystems gracefully
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Atlas Intelligence Platform...');

    try {
      // Shutdown in reverse order

      // Playbooks
      if (platformStatus.playbooksReady) {
        const { getPlaybookManager } = await import('./playbooks');
        await getPlaybookManager().shutdown();
      }

      // COP
      if (platformStatus.copReady) {
        const { getCOPManager } = await import('./cop');
        await getCOPManager().shutdown();
      }

      // Dynamic layer
      if (platformStatus.dynamicLayerReady) {
        const { getDynamicLayerManager } = await import('./dynamic');
        await getDynamicLayerManager().shutdown();
      }

      // Agents
      if (platformStatus.agentsReady) {
        const { getAgentRegistry } = await import('./agents');
        await getAgentRegistry().shutdown();
      }

      // Temporal
      if (platformStatus.temporalReady) {
        const { getTemporalEngine } = await import('./temporal');
        await getTemporalEngine().shutdown();
      }

      // Knowledge graph
      if (platformStatus.knowledgeGraphReady) {
        const { getKnowledgeGraphEngine } = await import('./knowledge-graph');
        await getKnowledgeGraphEngine().shutdown();
      }

      // Entity resolution
      if (platformStatus.entityResolutionReady) {
        const { getEntityResolutionEngine } = await import('./entity-resolution');
        await getEntityResolutionEngine().shutdown();
      }

      // Semantic layer
      if (platformStatus.semanticReady) {
        const { getSemanticLayerManager } = await import('./semantic');
        await getSemanticLayerManager().shutdown();
      }

      // Ontology (close database)
      if (platformStatus.ontologyReady) {
        const { getOntologyStore } = await import('./ontology');
        await getOntologyStore().close();
      }

      // Security
      if (platformStatus.securityReady) {
        const { getSecurityManager } = await import('./security');
        await getSecurityManager().shutdown();
      }

      // Reset status
      platformStatus = {
        initialized: false,
        ontologyReady: false,
        semanticReady: false,
        entityResolutionReady: false,
        knowledgeGraphReady: false,
        temporalReady: false,
        agentsReady: false,
        dynamicLayerReady: false,
        copReady: false,
        playbooksReady: false,
        securityReady: false,
        ipcRegistered: false,
      };

      this.initPromise = null;
      logger.info('Atlas Intelligence Platform shutdown complete');
      this.emit('shutdown');

    } catch (error) {
      logger.error('Error during shutdown:', error as Record<string, unknown>);
      throw error;
    }
  }

  /**
   * Get current status of all modules
   */
  getStatus(): IntelligencePlatformStatus {
    return { ...platformStatus };
  }

  /**
   * Check if fully initialized
   */
  isReady(): boolean {
    return platformStatus.initialized;
  }

  /**
   * Wait for initialization to complete
   */
  async waitForReady(): Promise<void> {
    if (platformStatus.initialized) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }
    throw new Error('Intelligence platform not initializing');
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * Get the intelligence platform manager singleton
 */
export function getIntelligencePlatformManager(): IntelligencePlatformManager {
  return IntelligencePlatformManager.getInstance();
}

/**
 * Initialize the entire intelligence platform
 * Call this from main/index.ts during app startup
 */
export async function initializeIntelligencePlatform(): Promise<void> {
  return getIntelligencePlatformManager().initialize();
}

/**
 * Shutdown the entire intelligence platform
 * Call this during app shutdown
 */
export async function shutdownIntelligencePlatform(): Promise<void> {
  return getIntelligencePlatformManager().shutdown();
}

/**
 * Get the current status of all intelligence modules
 */
export function getIntelligencePlatformStatus(): IntelligencePlatformStatus {
  return getIntelligencePlatformManager().getStatus();
}

/**
 * Check if intelligence platform is fully ready
 */
export function isIntelligencePlatformReady(): boolean {
  return getIntelligencePlatformManager().isReady();
}

// Re-export types
export type { IntelligencePlatformStatus };
