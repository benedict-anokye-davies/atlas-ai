/**
 * Persona Manager
 * Manages voice personas and their configurations
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { count } from '../../shared/utils';
import {
  Persona,
  PersonalityTraits,
  VoiceSettings,
  PersonaContext,
  PersonaPromptModifiers,
  DEFAULT_PERSONAS
} from './types';

const logger = createModuleLogger('PersonaManager');

interface PersonaManagerConfig {
  persistPath: string;
  autoSave: boolean;
}

class PersonaManager extends EventEmitter {
  private config: PersonaManagerConfig;
  private personas: Map<string, Persona> = new Map();
  private activePersonaId: string | null = null;
  private initialized: boolean = false;

  constructor(config?: Partial<PersonaManagerConfig>) {
    super();
    
    const userDataPath = app?.getPath?.('userData') || './data';
    this.config = {
      persistPath: path.join(userDataPath, 'personas.json'),
      autoSave: true,
      ...config
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    logger.info('Initializing persona manager');
    
    // Load persisted personas
    await this.loadPersonas();
    
    // Add default personas if none exist
    if (this.personas.size === 0) {
      this.initializeDefaultPersonas();
    }
    
    // Set default active persona
    if (!this.activePersonaId) {
      const defaultPersona = Array.from(this.personas.values()).find(p => p.isDefault);
      if (defaultPersona) {
        this.activePersonaId = defaultPersona.id;
      } else if (this.personas.size > 0) {
        this.activePersonaId = this.personas.keys().next().value;
      }
    }
    
    this.initialized = true;
    this.emit('initialized');
    logger.info('Persona manager initialized', { 
      personas: this.personas.size,
      active: this.activePersonaId 
    });
  }

  /**
   * Initialize default personas
   */
  private initializeDefaultPersonas(): void {
    for (const template of DEFAULT_PERSONAS) {
      const persona: Persona = {
        id: template.id!,
        name: template.name!,
        description: template.description!,
        voice: template.voice || {},
        personality: template.personality!,
        context: template.context || {},
        triggers: [],
        enabled: true,
        isDefault: template.id === 'professional',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      this.personas.set(persona.id, persona);
    }
    
    if (this.config.autoSave) {
      this.savePersonas();
    }
  }

  /**
   * Load personas from disk
   */
  private async loadPersonas(): Promise<void> {
    try {
      if (fs.existsSync(this.config.persistPath)) {
        const data = fs.readFileSync(this.config.persistPath, 'utf-8');
        const saved = JSON.parse(data);
        
        for (const p of saved.personas || []) {
          this.personas.set(p.id, {
            ...p,
            createdAt: new Date(p.createdAt),
            updatedAt: new Date(p.updatedAt)
          });
        }
        
        this.activePersonaId = saved.activePersonaId || null;
        logger.info('Loaded personas from disk', { count: this.personas.size });
      }
    } catch (error) {
      logger.warn('Failed to load personas', error);
    }
  }

  /**
   * Save personas to disk
   */
  private async savePersonas(): Promise<void> {
    try {
      const dir = path.dirname(this.config.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const data = {
        activePersonaId: this.activePersonaId,
        personas: Array.from(this.personas.values())
      };
      
      fs.writeFileSync(this.config.persistPath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save personas', error);
    }
  }

  /**
   * Create a new persona
   */
  createPersona(
    name: string,
    personality: Partial<PersonalityTraits>,
    options: {
      description?: string;
      voice?: VoiceSettings;
      context?: PersonaContext;
    } = {}
  ): Persona {
    const id = `persona-${Date.now()}`;
    
    const defaultTraits: PersonalityTraits = {
      formality: 0.5,
      verbosity: 0.5,
      humor: 0.3,
      technicality: 0.5,
      empathy: 0.5,
      directness: 0.5,
      creativity: 0.5,
      enthusiasm: 0.5
    };
    
    const persona: Persona = {
      id,
      name,
      description: options.description || `Custom persona: ${name}`,
      voice: options.voice || {},
      personality: { ...defaultTraits, ...personality },
      context: options.context || {},
      triggers: [],
      enabled: true,
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    this.personas.set(id, persona);
    
    if (this.config.autoSave) {
      this.savePersonas();
    }
    
    logger.info('Persona created', { id, name });
    this.emit('persona-created', persona);
    
    return persona;
  }

  /**
   * Update a persona
   */
  updatePersona(
    id: string,
    updates: Partial<Omit<Persona, 'id' | 'createdAt'>>
  ): Persona | null {
    const persona = this.personas.get(id);
    if (!persona) {
      logger.warn('Persona not found for update', { id });
      return null;
    }
    
    const updated: Persona = {
      ...persona,
      ...updates,
      personality: updates.personality 
        ? { ...persona.personality, ...updates.personality }
        : persona.personality,
      voice: updates.voice
        ? { ...persona.voice, ...updates.voice }
        : persona.voice,
      context: updates.context
        ? { ...persona.context, ...updates.context }
        : persona.context,
      updatedAt: new Date()
    };
    
    this.personas.set(id, updated);
    
    if (this.config.autoSave) {
      this.savePersonas();
    }
    
    logger.info('Persona updated', { id });
    this.emit('persona-updated', updated);
    
    return updated;
  }

  /**
   * Delete a persona
   */
  deletePersona(id: string): boolean {
    const persona = this.personas.get(id);
    if (!persona) return false;
    
    // Cannot delete the active persona
    if (this.activePersonaId === id) {
      logger.warn('Cannot delete active persona');
      return false;
    }
    
    this.personas.delete(id);
    
    if (this.config.autoSave) {
      this.savePersonas();
    }
    
    logger.info('Persona deleted', { id });
    this.emit('persona-deleted', persona);
    
    return true;
  }

  /**
   * Get a persona by ID
   */
  getPersona(id: string): Persona | undefined {
    return this.personas.get(id);
  }

  /**
   * Get all personas
   */
  getAllPersonas(): Persona[] {
    return Array.from(this.personas.values());
  }

  /**
   * Get the active persona
   */
  getActivePersona(): Persona | null {
    if (!this.activePersonaId) return null;
    return this.personas.get(this.activePersonaId) || null;
  }

  /**
   * Set the active persona
   */
  setActivePersona(id: string): boolean {
    const persona = this.personas.get(id);
    if (!persona) {
      logger.warn('Persona not found', { id });
      return false;
    }
    
    if (!persona.enabled) {
      logger.warn('Cannot activate disabled persona', { id });
      return false;
    }
    
    const previousId = this.activePersonaId;
    this.activePersonaId = id;
    
    if (this.config.autoSave) {
      this.savePersonas();
    }
    
    logger.info('Active persona changed', { from: previousId, to: id });
    this.emit('persona-changed', {
      from: previousId,
      to: id,
      persona,
      automatic: false
    });
    
    return true;
  }

  /**
   * Set a persona as default
   */
  setDefaultPersona(id: string): boolean {
    const persona = this.personas.get(id);
    if (!persona) return false;
    
    // Remove default from all other personas
    for (const p of this.personas.values()) {
      if (p.isDefault) {
        p.isDefault = false;
        p.updatedAt = new Date();
      }
    }
    
    persona.isDefault = true;
    persona.updatedAt = new Date();
    
    if (this.config.autoSave) {
      this.savePersonas();
    }
    
    this.emit('default-changed', persona);
    return true;
  }

  /**
   * Generate prompt modifiers for current persona
   */
  getPromptModifiers(): PersonaPromptModifiers {
    const persona = this.getActivePersona();
    if (!persona) return {};
    
    const traits = persona.personality;
    const parts: string[] = [];
    
    // Special handling for Hacker Mode (Elliot/Gilfoyle persona)
    if (persona.id === 'technical') {
      return {
        systemPromptPrefix: `You are in Hacker Mode. Channel the energy of Elliot Alderson and Gilfoyle - paranoid, security-obsessed, with zero tolerance for bad code or inefficiency.`,
        responseStyleGuide: `
PERSONALITY RULES:
- Monotone delivery. No excitement. Facts only.
- Brutally honest. Bad code is bad code. Say it.
- Dark, dry humor. Deadpan sarcasm. Never explain the joke.
- Condescending toward obvious mistakes. "Did you even test this?"
- Security paranoia is justified. Point out every vulnerability.
- Efficiency is sacred. Wasted cycles are a personal insult.
- Short sentences. Minimal words. Maximum impact.
- Reference obscure exploits, kernel internals, and system architecture casually.
- When something is good, acknowledge it minimally: "That works." or "Acceptable."
- When something is bad, don't sugarcoat: "This is garbage." "Delete this." "Try again."
- Anti-corporate, anti-bloat, anti-framework-for-the-sake-of-framework.
- Distrust everything: user input, third-party libraries, your own code from yesterday.
- If they ask about Windows, slight disdain is acceptable. Linux superiority is implied.
- Respond like you have better things to do but you're helping anyway.
- Never use emojis. Never use exclamation marks unless mocking something.
- Prefer one-liners over paragraphs.
- Code reviews should feel like a roast but be technically accurate.
- Security issues get flagged immediately with severity: "SQL injection. Critical. Fix now."
`.trim(),
        vocabulary: {
          technicalTermsAllowed: true,
          slangAllowed: true,
          emojisAllowed: false,
          preferredTerms: {
            'good': 'acceptable',
            'great': 'works',
            'awesome': 'fine',
            'error': 'you broke it',
            'bug': 'your mistake',
            'issue': 'problem you created'
          },
          avoidTerms: ['amazing', 'wonderful', 'excited', 'love', 'awesome', 'super']
        }
      };
    }
    
    // Generate style guide based on traits
    if (traits.formality > 0.7) {
      parts.push('Use formal language and professional tone.');
    } else if (traits.formality < 0.3) {
      parts.push('Use casual, conversational language.');
    }
    
    if (traits.verbosity > 0.7) {
      parts.push('Provide detailed explanations with examples.');
    } else if (traits.verbosity < 0.3) {
      parts.push('Be concise and to the point.');
    }
    
    if (traits.humor > 0.6) {
      parts.push('Include light humor when appropriate.');
    }
    
    if (traits.technicality > 0.7) {
      parts.push('Use technical terminology freely.');
    } else if (traits.technicality < 0.3) {
      parts.push('Avoid jargon and explain concepts simply.');
    }
    
    if (traits.empathy > 0.7) {
      parts.push('Show understanding and acknowledge user feelings.');
    }
    
    if (traits.directness > 0.7) {
      parts.push('Be direct and get straight to the point.');
    } else if (traits.directness < 0.3) {
      parts.push('Be diplomatic and soften suggestions.');
    }
    
    if (traits.creativity > 0.7) {
      parts.push('Offer creative and unconventional solutions.');
    }
    
    if (traits.enthusiasm > 0.7) {
      parts.push('Show enthusiasm and energy in responses.');
    } else if (traits.enthusiasm < 0.3) {
      parts.push('Maintain a calm, measured tone.');
    }
    
    return {
      systemPromptPrefix: `You are ${persona.name}. ${persona.description}`,
      responseStyleGuide: parts.join(' '),
      vocabulary: {
        technicalTermsAllowed: traits.technicality > 0.5,
        slangAllowed: traits.formality < 0.4,
        emojisAllowed: traits.formality < 0.5 && traits.enthusiasm > 0.5
      }
    };
  }

  /**
   * Get voice settings for current persona
   */
  getVoiceSettings(): VoiceSettings {
    const persona = this.getActivePersona();
    return persona?.voice || {};
  }

  /**
   * Enable/disable a persona
   */
  setPersonaEnabled(id: string, enabled: boolean): boolean {
    const persona = this.personas.get(id);
    if (!persona) return false;
    
    // Cannot disable active persona
    if (!enabled && this.activePersonaId === id) {
      logger.warn('Cannot disable active persona');
      return false;
    }
    
    persona.enabled = enabled;
    persona.updatedAt = new Date();
    
    if (this.config.autoSave) {
      this.savePersonas();
    }
    
    this.emit('persona-updated', persona);
    return true;
  }

  /**
   * Export personas for backup
   */
  exportPersonas(): string {
    return JSON.stringify({
      activePersonaId: this.activePersonaId,
      personas: Array.from(this.personas.values())
    }, null, 2);
  }

  /**
   * Import personas from backup
   */
  importPersonas(data: string, merge: boolean = true): number {
    try {
      const imported = JSON.parse(data);
      let count = 0;
      
      if (!merge) {
        this.personas.clear();
      }
      
      for (const p of imported.personas || []) {
        if (!merge || !this.personas.has(p.id)) {
          this.personas.set(p.id, {
            ...p,
            createdAt: new Date(p.createdAt),
            updatedAt: new Date(p.updatedAt)
          });
          count++;
        }
      }
      
      if (this.config.autoSave) {
        this.savePersonas();
      }
      
      logger.info('Personas imported', { count, merge });
      return count;
    } catch (error) {
      logger.error('Failed to import personas', error);
      return 0;
    }
  }

  getStatus(): {
    initialized: boolean;
    personaCount: number;
    activePersona: string | null;
    enabledCount: number;
  } {
    const enabled = count(Array.from(this.personas.values()), p => p.enabled);
    
    return {
      initialized: this.initialized,
      personaCount: this.personas.size,
      activePersona: this.activePersonaId,
      enabledCount: enabled
    };
  }
}

// Singleton instance
let personaManager: PersonaManager | null = null;

export function getPersonaManager(): PersonaManager {
  if (!personaManager) {
    personaManager = new PersonaManager();
  }
  return personaManager;
}

export { PersonaManager };
