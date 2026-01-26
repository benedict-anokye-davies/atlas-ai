/**
 * Automation Module Exports
 */

export * from './AutomationRoutines';
export { default as AutomationRoutinesManager, getAutomationManager } from './AutomationRoutines';

// New automation system exports
export * from './types';
export { getContextMonitor, ContextMonitor } from './context-monitor';
export { getTriggerEngine, TriggerEngine } from './trigger-engine';

import { getContextMonitor } from './context-monitor';
import { getTriggerEngine } from './trigger-engine';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('Automation');

/**
 * Initialize the automation system
 */
export async function initializeAutomation(): Promise<void> {
  logger.info('Initializing automation system');
  
  const contextMonitor = getContextMonitor();
  const triggerEngine = getTriggerEngine();
  
  await contextMonitor.initialize();
  await triggerEngine.initialize();
  
  // Start context monitoring
  contextMonitor.start();
  
  logger.info('Automation system initialized');
}

/**
 * Create a simple trigger helper
 */
export function createTrigger(
  name: string,
  type: 'time' | 'application' | 'system' | 'voice',
  condition: Record<string, unknown>,
  actions: Array<{ type: string; params: Record<string, unknown> }>
) {
  const trigger = {
    id: `trigger-${Date.now()}`,
    name,
    type,
    condition: { type, ...condition },
    actions: actions.map((a, i) => ({
      id: `action-${i}`,
      ...a
    })),
    enabled: true,
    priority: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  
  getTriggerEngine().registerTrigger(trigger as any);
  return trigger;
}

/**
 * Get automation system status
 */
export function getAutomationStatus() {
  return {
    contextMonitor: getContextMonitor().getStatus(),
    triggerEngine: getTriggerEngine().getStatus()
  };
}
