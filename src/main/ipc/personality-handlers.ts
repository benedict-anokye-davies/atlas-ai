/**
 * Personality IPC Handlers
 * IPC handlers for voice personas system
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { createModuleLogger } from '../utils/logger';
import {
  getPersonaManager,
  getContextSwitcher,
  initializePersonality
} from '../personality';
import { Persona, PersonalityTraits, VoiceSettings } from '../personality/types';

const logger = createModuleLogger('PersonalityIPC');

/**
 * Register all personality IPC handlers
 */
export function registerPersonalityHandlers(): void {
  logger.info('Registering personality IPC handlers');

  // Initialize personality system
  ipcMain.handle('personality:initialize', async () => {
    try {
      await initializePersonality();
      return { success: true };
    } catch (error) {
      logger.error('Failed to initialize personality', error);
      return { success: false, error: String(error) };
    }
  });

  // Get system status
  ipcMain.handle('personality:getStatus', async () => {
    try {
      const manager = getPersonaManager();
      const switcher = getContextSwitcher();
      return {
        success: true,
        data: {
          manager: manager.getStatus(),
          switcher: switcher.getStatus()
        }
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get all personas
  ipcMain.handle('personality:getAll', async () => {
    try {
      const manager = getPersonaManager();
      const personas = manager.getAllPersonas();
      return { success: true, data: personas };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get active persona
  ipcMain.handle('personality:getActive', async () => {
    try {
      const manager = getPersonaManager();
      const persona = manager.getActivePersona();
      return { success: true, data: persona };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Set active persona
  ipcMain.handle('personality:setActive', async (
    _event: IpcMainInvokeEvent,
    personaId: string
  ) => {
    try {
      const manager = getPersonaManager();
      const success = manager.setActivePersona(personaId);
      return { success };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Create persona
  ipcMain.handle('personality:create', async (
    _event: IpcMainInvokeEvent,
    persona: Omit<Persona, 'id' | 'createdAt' | 'updatedAt'>
  ) => {
    try {
      const manager = getPersonaManager();
      const created = manager.createPersona(persona);
      return { success: true, data: created };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Update persona
  ipcMain.handle('personality:update', async (
    _event: IpcMainInvokeEvent,
    personaId: string,
    updates: Partial<Pick<Persona, 'name' | 'description' | 'traits' | 'voiceSettings' | 'contextTriggers' | 'promptModifiers'>>
  ) => {
    try {
      const manager = getPersonaManager();
      const updated = manager.updatePersona(personaId, updates);
      return { success: true, data: updated };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Delete persona
  ipcMain.handle('personality:delete', async (
    _event: IpcMainInvokeEvent,
    personaId: string
  ) => {
    try {
      const manager = getPersonaManager();
      const success = manager.deletePersona(personaId);
      return { success };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get prompt modifiers for active persona
  ipcMain.handle('personality:getPromptModifiers', async () => {
    try {
      const manager = getPersonaManager();
      const modifiers = manager.getPromptModifiers();
      return { success: true, data: modifiers };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get voice settings for active persona
  ipcMain.handle('personality:getVoiceSettings', async () => {
    try {
      const manager = getPersonaManager();
      const settings = manager.getVoiceSettings();
      return { success: true, data: settings };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Enable/disable auto-switching
  ipcMain.handle('personality:setAutoSwitch', async (
    _event: IpcMainInvokeEvent,
    enabled: boolean
  ) => {
    try {
      const switcher = getContextSwitcher();
      switcher.setAutoSwitchEnabled(enabled);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Check context and potentially switch persona
  ipcMain.handle('personality:checkContext', async (
    _event: IpcMainInvokeEvent,
    context: {
      activeApp?: string;
      currentTime?: string;
      recentKeywords?: string[];
    }
  ) => {
    try {
      const switcher = getContextSwitcher();
      const switched = switcher.checkAndSwitch(context);
      return { success: true, data: { switched } };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Handle voice command for persona switching
  ipcMain.handle('personality:handleVoiceCommand', async (
    _event: IpcMainInvokeEvent,
    command: string
  ) => {
    try {
      const switcher = getContextSwitcher();
      const handled = switcher.handleVoiceCommand(command);
      return { success: handled };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Get context trigger suggestions
  ipcMain.handle('personality:getSwitchHistory', async (
    _event: IpcMainInvokeEvent,
    limit?: number
  ) => {
    try {
      const switcher = getContextSwitcher();
      const history = switcher.getSwitchHistory(limit);
      return { success: true, data: history };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  logger.info('Personality IPC handlers registered');
}
