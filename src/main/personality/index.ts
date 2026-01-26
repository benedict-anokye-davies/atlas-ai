/**
 * Personality System
 * Entry point for voice personas and context switching
 */

export * from './types';
export { getPersonaManager, PersonaManager } from './persona-manager';
export { getContextSwitcher, ContextSwitcher } from './context-switcher';

import { getPersonaManager } from './persona-manager';
import { getContextSwitcher } from './context-switcher';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('Personality');

/**
 * Initialize the personality system
 */
export async function initializePersonality(): Promise<void> {
  logger.info('Initializing personality system');
  
  const personaManager = getPersonaManager();
  const contextSwitcher = getContextSwitcher();
  
  await personaManager.initialize();
  await contextSwitcher.initialize();
  
  logger.info('Personality system initialized');
}

/**
 * Get personality system status
 */
export function getPersonalityStatus() {
  return {
    personaManager: getPersonaManager().getStatus(),
    contextSwitcher: getContextSwitcher().getStatus()
  };
}

/**
 * Get current persona's prompt modifiers for LLM
 */
export function getCurrentPromptModifiers() {
  return getPersonaManager().getPromptModifiers();
}

/**
 * Get current persona's voice settings for TTS
 */
export function getCurrentVoiceSettings() {
  return getPersonaManager().getVoiceSettings();
}
