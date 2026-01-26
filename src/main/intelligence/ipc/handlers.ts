/**
 * Intelligence IPC Handlers
 * IPC handlers for renderer communication with the intelligence system
 */

import { ipcMain } from 'electron';
import { createModuleLogger } from '../../utils/logger';

// Import managers (will be initialized in main index)
import { getOntologyStore } from '../ontology';
import { getEntityManager } from '../ontology';
import { getRelationshipManager } from '../ontology';
import { getKnowledgeGraphEngine } from '../knowledge-graph';
import { getTemporalEngine } from '../temporal';
import { getAgentRegistry, routeQuery } from '../agents';
import { getDynamicLayerManager } from '../dynamic';
import { getCOPManager } from '../cop';
import { getPlaybookManager } from '../playbooks';
import { getSecurityManager } from '../security';

const logger = createModuleLogger('IntelligenceIPC');

// ============================================================================
// RESPONSE HELPERS
// ============================================================================

interface IPCResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

function success<T>(data: T): IPCResponse<T> {
  return { success: true, data };
}

function error(message: string): IPCResponse {
  return { success: false, error: message };
}

// ============================================================================
// REGISTER ALL HANDLERS
// ============================================================================

export function registerIntelligenceIPC(): void {
  logger.info('Registering intelligence IPC handlers...');

  // Entity handlers
  registerEntityHandlers();

  // Relationship handlers
  registerRelationshipHandlers();

  // Knowledge graph handlers
  registerKnowledgeGraphHandlers();

  // Agent handlers
  registerAgentHandlers();

  // COP handlers
  registerCOPHandlers();

  // Playbook handlers
  registerPlaybookHandlers();

  // Dynamic layer handlers
  registerDynamicLayerHandlers();

  // Security handlers
  registerSecurityHandlers();

  logger.info('Intelligence IPC handlers registered');
}

// ============================================================================
// ENTITY HANDLERS
// ============================================================================

function registerEntityHandlers(): void {
  const manager = () => getEntityManager();
  const security = () => getSecurityManager();

  // Create entity
  ipcMain.handle('intelligence:entity:create', async (_, type: string, data: any) => {
    try {
      security().requirePermission('entity:write');
      const entity = await manager().createEntity(type as any, data);
      security().auditEntityOperation('entity:create', type, entity.id, { data });
      return success(entity);
    } catch (err) {
      logger.error('Failed to create entity:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get entity by ID
  ipcMain.handle('intelligence:entity:get', async (_, id: string) => {
    try {
      security().requirePermission('entity:read');
      const entity = await manager().getEntity(id);
      return success(entity);
    } catch (err) {
      logger.error('Failed to get entity:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Update entity
  ipcMain.handle('intelligence:entity:update', async (_, id: string, updates: any) => {
    try {
      security().requirePermission('entity:write');
      const entity = await manager().updateEntity(id, updates);
      security().auditEntityOperation('entity:update', entity?.type ?? 'unknown', id, { updates });
      return success(entity);
    } catch (err) {
      logger.error('Failed to update entity:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Delete entity
  ipcMain.handle('intelligence:entity:delete', async (_, id: string) => {
    try {
      security().requirePermission('entity:delete');
      const result = await manager().deleteEntity(id);
      security().auditEntityOperation('entity:delete', 'unknown', id);
      return success(result);
    } catch (err) {
      logger.error('Failed to delete entity:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Search entities
  ipcMain.handle('intelligence:entity:search', async (_, query: string, options?: any) => {
    try {
      security().requirePermission('entity:read');
      const results = await manager().searchEntities(query, options);
      security().auditQuery(query, undefined, results.length);
      return success(results);
    } catch (err) {
      logger.error('Failed to search entities:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get entities by type
  ipcMain.handle('intelligence:entity:byType', async (_, type: string, options?: any) => {
    try {
      security().requirePermission('entity:read');
      const entities = await manager().getEntitiesByType(type as any, options);
      return success(entities);
    } catch (err) {
      logger.error('Failed to get entities by type:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });
}

// ============================================================================
// RELATIONSHIP HANDLERS
// ============================================================================

function registerRelationshipHandlers(): void {
  const manager = () => getRelationshipManager();

  // Create relationship
  ipcMain.handle('intelligence:relationship:create', async (_, data: any) => {
    try {
      const relationship = await manager().createRelationship(data);
      return success(relationship);
    } catch (err) {
      logger.error('Failed to create relationship:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get relationships for entity
  ipcMain.handle('intelligence:relationship:forEntity', async (_, entityId: string, options?: any) => {
    try {
      const relationships = await manager().getRelationshipsForEntity(entityId, options);
      return success(relationships);
    } catch (err) {
      logger.error('Failed to get relationships:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Delete relationship
  ipcMain.handle('intelligence:relationship:delete', async (_, id: string) => {
    try {
      const result = await manager().deleteRelationship(id);
      return success(result);
    } catch (err) {
      logger.error('Failed to delete relationship:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });
}

// ============================================================================
// KNOWLEDGE GRAPH HANDLERS
// ============================================================================

function registerKnowledgeGraphHandlers(): void {
  const graph = () => getKnowledgeGraphEngine();

  // Find paths between entities
  ipcMain.handle('intelligence:graph:findPaths', async (_, fromId: string, toId: string, options?: any) => {
    try {
      const paths = await graph().findPaths(fromId, toId, options);
      return success(paths);
    } catch (err) {
      logger.error('Failed to find paths:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get connected entities
  ipcMain.handle('intelligence:graph:connected', async (_, entityId: string, options?: any) => {
    try {
      const connected = await graph().getConnectedEntities(entityId, options);
      return success(connected);
    } catch (err) {
      logger.error('Failed to get connected entities:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get entity centrality
  ipcMain.handle('intelligence:graph:centrality', async (_, entityId: string) => {
    try {
      const centrality = await graph().calculateCentrality(entityId);
      return success(centrality);
    } catch (err) {
      logger.error('Failed to calculate centrality:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Detect communities
  ipcMain.handle('intelligence:graph:communities', async (_, options?: any) => {
    try {
      const communities = await graph().detectCommunities(options);
      return success(communities);
    } catch (err) {
      logger.error('Failed to detect communities:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get influential entities
  ipcMain.handle('intelligence:graph:influential', async (_, limit?: number) => {
    try {
      const entities = await graph().getInfluentialEntities(limit);
      return success(entities);
    } catch (err) {
      logger.error('Failed to get influential entities:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });
}

// ============================================================================
// AGENT HANDLERS
// ============================================================================

function registerAgentHandlers(): void {
  const registry = () => getAgentRegistry();

  // Query agents (unified)
  ipcMain.handle('intelligence:agent:query', async (_, query: string, options?: any) => {
    try {
      const startTime = Date.now();
      const response = await routeQuery(query, options);
      const duration = Date.now() - startTime;
      
      getSecurityManager().auditQuery(query, response.agentId, undefined, duration);
      return success(response);
    } catch (err) {
      logger.error('Agent query failed:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Query specific agent
  ipcMain.handle('intelligence:agent:querySpecific', async (_, agentId: string, query: string, context?: any) => {
    try {
      const agent = registry().getAgent(agentId as any);
      if (!agent) {
        return error(`Agent not found: ${agentId}`);
      }
      const response = await agent.query(query, context);
      return success(response);
    } catch (err) {
      logger.error('Specific agent query failed:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get all alerts
  ipcMain.handle('intelligence:agent:alerts', async () => {
    try {
      const alerts = await registry().getAllAlerts();
      return success(alerts);
    } catch (err) {
      logger.error('Failed to get alerts:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get all recommendations
  ipcMain.handle('intelligence:agent:recommendations', async () => {
    try {
      const recommendations = await registry().getAllRecommendations();
      return success(recommendations);
    } catch (err) {
      logger.error('Failed to get recommendations:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get agent status
  ipcMain.handle('intelligence:agent:status', async () => {
    try {
      const agents = registry().getAgentStatuses();
      return success(agents);
    } catch (err) {
      logger.error('Failed to get agent status:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });
}

// ============================================================================
// COP HANDLERS
// ============================================================================

function registerCOPHandlers(): void {
  const cop = () => getCOPManager();

  // Get full COP state
  ipcMain.handle('intelligence:cop:state', async () => {
    try {
      const state = await cop().getState();
      return success(state);
    } catch (err) {
      logger.error('Failed to get COP state:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get summary only
  ipcMain.handle('intelligence:cop:summary', async () => {
    try {
      const summary = cop().getSummary();
      return success(summary);
    } catch (err) {
      logger.error('Failed to get COP summary:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Refresh state
  ipcMain.handle('intelligence:cop:refresh', async () => {
    try {
      const state = await cop().refreshState();
      return success(state);
    } catch (err) {
      logger.error('Failed to refresh COP state:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get alerts
  ipcMain.handle('intelligence:cop:alerts', async (_, filter?: any) => {
    try {
      const alerts = await cop().getAlerts(filter);
      return success(alerts);
    } catch (err) {
      logger.error('Failed to get COP alerts:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Acknowledge alert
  ipcMain.handle('intelligence:cop:acknowledgeAlert', async (_, alertId: string) => {
    try {
      cop().acknowledgeAlert(alertId);
      return success(true);
    } catch (err) {
      logger.error('Failed to acknowledge alert:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Snooze alert
  ipcMain.handle('intelligence:cop:snoozeAlert', async (_, alertId: string, minutes?: number) => {
    try {
      cop().snoozeAlert(alertId, minutes);
      return success(true);
    } catch (err) {
      logger.error('Failed to snooze alert:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get recommendations
  ipcMain.handle('intelligence:cop:recommendations', async (_, filter?: any) => {
    try {
      const recommendations = await cop().getRecommendations(filter);
      return success(recommendations);
    } catch (err) {
      logger.error('Failed to get recommendations:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get quick wins
  ipcMain.handle('intelligence:cop:quickWins', async () => {
    try {
      const quickWins = await cop().getQuickWins();
      return success(quickWins);
    } catch (err) {
      logger.error('Failed to get quick wins:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get insights
  ipcMain.handle('intelligence:cop:insights', async () => {
    try {
      const insights = await cop().getInsights();
      return success(insights);
    } catch (err) {
      logger.error('Failed to get insights:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Context management
  ipcMain.handle('intelligence:cop:startContext', async (_, type: any, name: string, options?: any) => {
    try {
      const contextId = cop().startContext(type, name, options);
      return success(contextId);
    } catch (err) {
      logger.error('Failed to start context:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  ipcMain.handle('intelligence:cop:endContext', async (_, contextId: string) => {
    try {
      cop().endContext(contextId);
      return success(true);
    } catch (err) {
      logger.error('Failed to end context:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  ipcMain.handle('intelligence:cop:activeContexts', async () => {
    try {
      const contexts = cop().getActiveContexts();
      return success(contexts);
    } catch (err) {
      logger.error('Failed to get active contexts:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });
}

// ============================================================================
// PLAYBOOK HANDLERS
// ============================================================================

function registerPlaybookHandlers(): void {
  const manager = () => getPlaybookManager();

  // Get all playbooks
  ipcMain.handle('intelligence:playbook:list', async () => {
    try {
      const playbooks = manager().getPlaybooks();
      return success(playbooks);
    } catch (err) {
      logger.error('Failed to list playbooks:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get playbook by ID
  ipcMain.handle('intelligence:playbook:get', async (_, id: string) => {
    try {
      const playbook = manager().getPlaybook(id);
      return success(playbook);
    } catch (err) {
      logger.error('Failed to get playbook:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Create playbook from template
  ipcMain.handle('intelligence:playbook:createFromTemplate', async (_, templateId: string, config?: any) => {
    try {
      const playbook = await manager().createFromTemplate(templateId, config);
      return success(playbook);
    } catch (err) {
      logger.error('Failed to create playbook from template:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Create custom playbook
  ipcMain.handle('intelligence:playbook:create', async (_, data: any) => {
    try {
      const playbook = await manager().createPlaybook(data);
      return success(playbook);
    } catch (err) {
      logger.error('Failed to create playbook:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Update playbook
  ipcMain.handle('intelligence:playbook:update', async (_, id: string, updates: any) => {
    try {
      const playbook = await manager().updatePlaybook(id, updates);
      return success(playbook);
    } catch (err) {
      logger.error('Failed to update playbook:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Delete playbook
  ipcMain.handle('intelligence:playbook:delete', async (_, id: string) => {
    try {
      const result = await manager().deletePlaybook(id);
      return success(result);
    } catch (err) {
      logger.error('Failed to delete playbook:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Activate/pause playbook
  ipcMain.handle('intelligence:playbook:activate', async (_, id: string) => {
    try {
      const result = await manager().activatePlaybook(id);
      return success(result);
    } catch (err) {
      logger.error('Failed to activate playbook:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  ipcMain.handle('intelligence:playbook:pause', async (_, id: string) => {
    try {
      const result = await manager().pausePlaybook(id);
      return success(result);
    } catch (err) {
      logger.error('Failed to pause playbook:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Trigger playbook manually
  ipcMain.handle('intelligence:playbook:trigger', async (_, id: string, data?: any) => {
    try {
      const executionId = manager().triggerPlaybook(id, data);
      return success(executionId);
    } catch (err) {
      logger.error('Failed to trigger playbook:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get templates
  ipcMain.handle('intelligence:playbook:templates', async () => {
    try {
      const templates = manager().getTemplates();
      return success(templates);
    } catch (err) {
      logger.error('Failed to get templates:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get execution history
  ipcMain.handle('intelligence:playbook:history', async (_, playbookId?: string, limit?: number) => {
    try {
      const history = manager().getExecutionHistory(playbookId, limit);
      return success(history);
    } catch (err) {
      logger.error('Failed to get execution history:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get playbook stats
  ipcMain.handle('intelligence:playbook:stats', async (_, playbookId: string) => {
    try {
      const stats = manager().getPlaybookStats(playbookId);
      return success(stats);
    } catch (err) {
      logger.error('Failed to get playbook stats:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });
}

// ============================================================================
// DYNAMIC LAYER HANDLERS
// ============================================================================

function registerDynamicLayerHandlers(): void {
  const dynamic = () => getDynamicLayerManager();

  // Record learning event
  ipcMain.handle('intelligence:dynamic:recordEvent', async (_, event: any) => {
    try {
      dynamic().recordEvent(event);
      return success(true);
    } catch (err) {
      logger.error('Failed to record event:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get predictions
  ipcMain.handle('intelligence:dynamic:predictions', async (_, type?: string) => {
    try {
      const predictions = await dynamic().getPredictions(type as any);
      return success(predictions);
    } catch (err) {
      logger.error('Failed to get predictions:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get patterns
  ipcMain.handle('intelligence:dynamic:patterns', async (_, type?: string) => {
    try {
      const patterns = await dynamic().getPatterns(type as any);
      return success(patterns);
    } catch (err) {
      logger.error('Failed to get patterns:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get insights
  ipcMain.handle('intelligence:dynamic:insights', async () => {
    try {
      const insights = await dynamic().getInsights();
      return success(insights);
    } catch (err) {
      logger.error('Failed to get dynamic insights:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });
}

// ============================================================================
// SECURITY HANDLERS
// ============================================================================

function registerSecurityHandlers(): void {
  const security = () => getSecurityManager();

  // Get audit logs
  ipcMain.handle('intelligence:security:auditLogs', async (_, filter?: any) => {
    try {
      security().requirePermission('security:view_audit');
      const logs = security().getAuditLogs(filter);
      return success(logs);
    } catch (err) {
      logger.error('Failed to get audit logs:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get audit stats
  ipcMain.handle('intelligence:security:auditStats', async (_, since?: string) => {
    try {
      security().requirePermission('security:view_audit');
      const sinceDate = since ? new Date(since) : undefined;
      const stats = security().getAuditStats(sinceDate);
      return success(stats);
    } catch (err) {
      logger.error('Failed to get audit stats:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Check permission
  ipcMain.handle('intelligence:security:hasPermission', async (_, permission: string) => {
    try {
      const hasPermission = security().hasPermission(permission as any);
      return success(hasPermission);
    } catch (err) {
      logger.error('Failed to check permission:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });

  // Get current user
  ipcMain.handle('intelligence:security:currentUser', async () => {
    try {
      const user = security().getCurrentUser();
      return success(user);
    } catch (err) {
      logger.error('Failed to get current user:', err as Record<string, unknown>);
      return error((err as Error).message);
    }
  });
}
