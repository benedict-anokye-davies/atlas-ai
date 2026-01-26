/**
 * Playbooks Module
 * Automated workflow execution system
 */

export * from './types';
export * from './playbook-engine';
export * from './templates';

import { createModuleLogger } from '../../utils/logger';
import { PlaybookEngine, getPlaybookEngine } from './playbook-engine';
import { ALL_TEMPLATES, getTemplate, getTemplatesByCategory } from './templates';
import { Playbook, PlaybookTemplate, PlaybookCategory, ActionType, Action } from './types';

const logger = createModuleLogger('Playbooks');

// ============================================================================
// PLAYBOOK MANAGER
// ============================================================================

export class PlaybookManager {
  private engine: PlaybookEngine;
  private initialized = false;

  constructor() {
    this.engine = getPlaybookEngine();
  }

  // --------------------------------------------------------------------------
  // INITIALIZATION
  // --------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    logger.info('Initializing playbook manager...');
    
    await this.engine.initialize();
    
    // Register custom action handlers
    this.registerCustomHandlers();
    
    this.initialized = true;
    logger.info('Playbook manager initialized');
  }

  async shutdown(): Promise<void> {
    await this.engine.shutdown();
    this.initialized = false;
    logger.info('Playbook manager shut down');
  }

  // --------------------------------------------------------------------------
  // PLAYBOOK MANAGEMENT
  // --------------------------------------------------------------------------

  /**
   * Create a playbook from a template
   */
  async createFromTemplate(
    templateId: string,
    config?: Record<string, unknown>
  ): Promise<Playbook | null> {
    const template = getTemplate(templateId);
    if (!template) {
      logger.warn(`Template not found: ${templateId}`);
      return null;
    }

    // Deep clone the template playbook
    const playbookData = JSON.parse(JSON.stringify(template.playbook));

    // Apply configuration
    if (config && template.prompts) {
      for (const prompt of template.prompts) {
        const value = config[prompt.name];
        if (value !== undefined) {
          this.setNestedValue(playbookData, prompt.variablePath, value);
        }
      }
    }

    return this.engine.createPlaybook(playbookData);
  }

  /**
   * Create a custom playbook
   */
  async createPlaybook(data: Parameters<PlaybookEngine['createPlaybook']>[0]): Promise<Playbook> {
    return this.engine.createPlaybook(data);
  }

  /**
   * Update a playbook
   */
  async updatePlaybook(id: string, updates: Partial<Playbook>): Promise<Playbook | null> {
    return this.engine.updatePlaybook(id, updates);
  }

  /**
   * Delete a playbook
   */
  async deletePlaybook(id: string): Promise<boolean> {
    return this.engine.deletePlaybook(id);
  }

  /**
   * Get all playbooks
   */
  getPlaybooks(): Playbook[] {
    return this.engine.getAllPlaybooks();
  }

  /**
   * Get playbook by ID
   */
  getPlaybook(id: string): Playbook | undefined {
    return this.engine.getPlaybook(id);
  }

  /**
   * Activate a playbook
   */
  async activatePlaybook(id: string): Promise<boolean> {
    const result = await this.engine.updatePlaybook(id, { status: 'active' });
    return result !== null;
  }

  /**
   * Pause a playbook
   */
  async pausePlaybook(id: string): Promise<boolean> {
    const result = await this.engine.updatePlaybook(id, { status: 'paused' });
    return result !== null;
  }

  // --------------------------------------------------------------------------
  // TEMPLATES
  // --------------------------------------------------------------------------

  /**
   * Get all templates
   */
  getTemplates(): PlaybookTemplate[] {
    return ALL_TEMPLATES;
  }

  /**
   * Get templates by category
   */
  getTemplatesByCategory(category: PlaybookCategory): PlaybookTemplate[] {
    return getTemplatesByCategory(category);
  }

  /**
   * Get template by ID
   */
  getTemplate(id: string): PlaybookTemplate | undefined {
    return getTemplate(id);
  }

  // --------------------------------------------------------------------------
  // EXECUTION
  // --------------------------------------------------------------------------

  /**
   * Manually trigger a playbook
   */
  triggerPlaybook(id: string, data?: unknown): string | null {
    return this.engine.manualTrigger(id, data);
  }

  /**
   * Confirm a pending execution
   */
  async confirmExecution(executionId: string): Promise<boolean> {
    return this.engine.confirmExecution(executionId);
  }

  /**
   * Cancel an execution
   */
  async cancelExecution(executionId: string): Promise<boolean> {
    return this.engine.cancelExecution(executionId);
  }

  /**
   * Get running executions
   */
  getRunningExecutions() {
    return this.engine.getRunningExecutions();
  }

  /**
   * Get execution history
   */
  getExecutionHistory(playbookId?: string, limit?: number) {
    return this.engine.getExecutionHistory(playbookId, limit);
  }

  /**
   * Get playbook statistics
   */
  getPlaybookStats(playbookId: string) {
    return this.engine.getPlaybookStats(playbookId);
  }

  // --------------------------------------------------------------------------
  // EVENT HANDLERS
  // --------------------------------------------------------------------------

  /**
   * Handle external event
   */
  handleEvent(eventName: string, data?: unknown): void {
    this.engine.handleEvent(eventName, data);
  }

  /**
   * Handle entity change
   */
  handleEntityChange(
    entityType: string,
    changeType: 'created' | 'updated' | 'deleted',
    entity: unknown
  ): void {
    this.engine.handleEntityChange(entityType, changeType, entity);
  }

  /**
   * Handle pattern detected
   */
  handlePatternDetected(patternType: string, confidence: number, data: unknown): void {
    this.engine.handlePatternDetected(patternType, confidence, data);
  }

  /**
   * Handle alert raised
   */
  handleAlertRaised(alertType: string, agentId: string, priority: number, data: unknown): void {
    this.engine.handleAlertRaised(alertType, agentId, priority, data);
  }

  /**
   * Handle voice command - returns triggered playbook if any
   */
  handleVoiceCommand(text: string): Playbook | null {
    return this.engine.handleVoiceCommand(text);
  }

  // --------------------------------------------------------------------------
  // ACTION HANDLERS
  // --------------------------------------------------------------------------

  /**
   * Register a custom action handler
   */
  registerActionHandler(
    type: ActionType,
    handler: (action: Action, context: any) => Promise<unknown>
  ): void {
    this.engine.registerActionHandler(type, handler);
  }

  private registerCustomHandlers(): void {
    // Integration with voice pipeline
    this.engine.registerActionHandler('voice', async (action, context) => {
      const config = (action as any).config;
      const text = this.interpolateVariables(config.text, context.variables);
      
      // In production, call voice pipeline
      logger.info(`[VOICE] Speaking: ${text}`);
      
      return { spoken: true, text };
    });

    // Integration with COP context
    this.engine.registerActionHandler('set_context', async (action, context) => {
      const config = (action as any).config;
      
      // In production, call COP manager
      logger.info(`[CONTEXT] Setting: ${config.contextType}:${config.contextName}`);
      
      return { contextSet: true };
    });

    // Integration with agent queries
    this.engine.registerActionHandler('run_query', async (action, context) => {
      const config = (action as any).config;
      const query = this.interpolateVariables(config.query, context.variables);
      
      // In production, call agent registry
      logger.info(`[QUERY] ${config.agentId || 'auto'}: ${query}`);
      
      return { result: 'Query result placeholder' };
    });

    // Integration with tools
    this.engine.registerActionHandler('run_tool', async (action, context) => {
      const config = (action as any).config;
      
      // In production, call tool executor
      logger.info(`[TOOL] ${config.toolName}`, config.params);
      
      return { result: 'Tool result placeholder' };
    });

    // Notifications via system
    this.engine.registerActionHandler('notify', async (action, context) => {
      const config = (action as any).config;
      const title = this.interpolateVariables(config.title, context.variables);
      const body = this.interpolateVariables(config.body, context.variables);
      
      // In production, call notification system
      logger.info(`[NOTIFY] ${title}: ${body}`);
      
      return { notified: true };
    });
  }

  // --------------------------------------------------------------------------
  // UTILITIES
  // --------------------------------------------------------------------------

  private setNestedValue(obj: any, path: string, value: unknown): void {
    const parts = path.match(/[^.[\]]+/g) || [];
    let current = obj;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        current[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      }
      current = current[part];
    }
    
    const lastPart = parts[parts.length - 1];
    current[lastPart] = value;
  }

  private interpolateVariables(text: string, variables: Record<string, unknown>): string {
    return text.replace(/\$\{([^}]+)\}/g, (match, path) => {
      const value = this.getNestedValue(variables, path);
      return value !== undefined ? String(value) : match;
    });
  }

  private getNestedValue(obj: any, path: string): unknown {
    const parts = path.match(/[^.[\]]+/g) || [];
    let current = obj;
    
    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }
    
    return current;
  }

  // --------------------------------------------------------------------------
  // EVENT FORWARDING
  // --------------------------------------------------------------------------

  on(event: string, listener: (...args: any[]) => void): this {
    this.engine.on(event, listener);
    return this;
  }

  off(event: string, listener: (...args: any[]) => void): this {
    this.engine.off(event, listener);
    return this;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: PlaybookManager | null = null;

export function getPlaybookManager(): PlaybookManager {
  if (!instance) {
    instance = new PlaybookManager();
  }
  return instance;
}

export async function initializePlaybooks(): Promise<void> {
  const manager = getPlaybookManager();
  await manager.initialize();
}
