/**
 * Context Switcher
 * Automatically switches personas based on context
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getPersonaManager } from './persona-manager';
import { getContextMonitor } from '../automation/context-monitor';
import { Persona, PersonaSwitch, PersonaContext, TimeRange } from './types';

const logger = createModuleLogger('ContextSwitcher');

interface ContextSwitcherConfig {
  enabled: boolean;
  debounceMs: number;
  minConfidence: number;
  allowVoiceOverride: boolean;
}

const DEFAULT_CONFIG: ContextSwitcherConfig = {
  enabled: true,
  debounceMs: 3000, // 3 seconds before switching
  minConfidence: 0.6,
  allowVoiceOverride: true
};

class ContextSwitcher extends EventEmitter {
  private config: ContextSwitcherConfig;
  private switchHistory: PersonaSwitch[] = [];
  private pendingSwitch: NodeJS.Timeout | null = null;
  private manualOverride: boolean = false;
  private overrideExpiry: Date | null = null;
  private initialized: boolean = false;

  constructor(config?: Partial<ContextSwitcherConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    logger.info('Initializing context switcher');
    
    // Subscribe to context changes
    const contextMonitor = getContextMonitor();
    
    contextMonitor.on('application-change', ({ current }) => {
      this.evaluateContextChange({ application: current });
    });
    
    contextMonitor.on('time-period-change', ({ current }) => {
      this.evaluateContextChange({ timePeriod: current });
    });
    
    contextMonitor.on('context-update', (state) => {
      this.evaluateContextChange({ fullState: state });
    });
    
    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Evaluate context change and potentially switch persona
   */
  private evaluateContextChange(change: {
    application?: string;
    timePeriod?: string;
    keyword?: string;
    fullState?: Record<string, unknown>;
  }): void {
    if (!this.config.enabled) return;
    
    // Skip if manual override is active
    if (this.manualOverride && this.overrideExpiry && this.overrideExpiry > new Date()) {
      return;
    } else {
      this.manualOverride = false;
      this.overrideExpiry = null;
    }
    
    // Find best matching persona
    const match = this.findBestPersona(change);
    
    if (!match) return;
    
    const personaManager = getPersonaManager();
    const currentPersona = personaManager.getActivePersona();
    
    // Skip if already using this persona
    if (currentPersona?.id === match.persona.id) return;
    
    // Debounce the switch
    if (this.pendingSwitch) {
      clearTimeout(this.pendingSwitch);
    }
    
    this.pendingSwitch = setTimeout(() => {
      this.switchPersona(match.persona, match.reason, true);
      this.pendingSwitch = null;
    }, this.config.debounceMs);
  }

  /**
   * Find the best matching persona for current context
   */
  private findBestPersona(context: {
    application?: string;
    timePeriod?: string;
    keyword?: string;
    fullState?: Record<string, unknown>;
  }): { persona: Persona; reason: string; confidence: number } | null {
    const personaManager = getPersonaManager();
    const personas = personaManager.getAllPersonas().filter(p => p.enabled);
    
    let bestMatch: { persona: Persona; reason: string; confidence: number } | null = null;
    
    for (const persona of personas) {
      const { confidence, reason } = this.calculateContextMatch(persona, context);
      
      if (confidence >= this.config.minConfidence) {
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { persona, reason, confidence };
        }
      }
    }
    
    return bestMatch;
  }

  /**
   * Calculate how well a persona matches the current context
   */
  private calculateContextMatch(
    persona: Persona,
    context: {
      application?: string;
      timePeriod?: string;
      keyword?: string;
      fullState?: Record<string, unknown>;
    }
  ): { confidence: number; reason: string } {
    const ctx = persona.context;
    let confidence = 0;
    let matchCount = 0;
    let totalChecks = 0;
    let reason = '';
    
    // Check application match
    if (ctx.applications && ctx.applications.length > 0) {
      totalChecks++;
      const app = context.application?.toLowerCase() || '';
      const matched = ctx.applications.some(a => 
        app.includes(a.toLowerCase()) || a.toLowerCase().includes(app)
      );
      if (matched) {
        matchCount++;
        reason = `Application: ${context.application}`;
      }
    }
    
    // Check time range match
    if (ctx.timeRanges && ctx.timeRanges.length > 0) {
      totalChecks++;
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      
      for (const range of ctx.timeRanges) {
        if (this.isTimeInRange(currentTime, range)) {
          matchCount++;
          reason = reason || `Time: ${currentTime}`;
          break;
        }
      }
    }
    
    // Check day of week match
    if (ctx.days && ctx.days.length > 0) {
      totalChecks++;
      const today = new Date().getDay();
      if (ctx.days.includes(today)) {
        matchCount++;
        reason = reason || `Day: ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][today]}`;
      }
    }
    
    // Check keyword match
    if (ctx.keywords && ctx.keywords.length > 0 && context.keyword) {
      totalChecks++;
      const keyword = context.keyword.toLowerCase();
      const matched = ctx.keywords.some(k => keyword.includes(k.toLowerCase()));
      if (matched) {
        matchCount++;
        reason = reason || `Keyword: ${context.keyword}`;
      }
    }
    
    // Calculate confidence
    if (totalChecks > 0) {
      confidence = matchCount / totalChecks;
      
      // Boost confidence for multiple matches
      if (matchCount > 1) {
        confidence = Math.min(1, confidence + 0.1 * (matchCount - 1));
      }
    }
    
    return { confidence, reason: reason || 'Context match' };
  }

  /**
   * Check if current time is within a range
   */
  private isTimeInRange(current: string, range: TimeRange): boolean {
    const [currentH, currentM] = current.split(':').map(Number);
    const [startH, startM] = range.start.split(':').map(Number);
    const [endH, endM] = range.end.split(':').map(Number);
    
    const currentMinutes = currentH * 60 + currentM;
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    
    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } else {
      // Range crosses midnight
      return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }
  }

  /**
   * Switch to a specific persona
   */
  private switchPersona(persona: Persona, reason: string, automatic: boolean): void {
    const personaManager = getPersonaManager();
    const previousPersona = personaManager.getActivePersona();
    
    if (personaManager.setActivePersona(persona.id)) {
      const switchRecord: PersonaSwitch = {
        from: previousPersona?.id || null,
        to: persona.id,
        reason,
        timestamp: new Date(),
        automatic
      };
      
      this.switchHistory.push(switchRecord);
      
      // Keep only last 50 switches
      if (this.switchHistory.length > 50) {
        this.switchHistory = this.switchHistory.slice(-50);
      }
      
      logger.info('Persona switched', { 
        from: previousPersona?.name, 
        to: persona.name, 
        reason,
        automatic 
      });
      
      this.emit('persona-switched', switchRecord);
    }
  }

  /**
   * Manually switch persona with optional override duration
   */
  manualSwitch(personaId: string, overrideMinutes?: number): boolean {
    const personaManager = getPersonaManager();
    const persona = personaManager.getPersona(personaId);
    
    if (!persona) {
      logger.warn('Persona not found for manual switch', { id: personaId });
      return false;
    }
    
    if (overrideMinutes) {
      this.manualOverride = true;
      this.overrideExpiry = new Date(Date.now() + overrideMinutes * 60 * 1000);
    }
    
    // Cancel any pending automatic switch
    if (this.pendingSwitch) {
      clearTimeout(this.pendingSwitch);
      this.pendingSwitch = null;
    }
    
    this.switchPersona(persona, 'Manual switch', false);
    return true;
  }

  /**
   * Handle voice command for persona switching
   */
  handleVoiceCommand(transcript: string): boolean {
    if (!this.config.allowVoiceOverride) return false;
    
    const lower = transcript.toLowerCase();
    
    // Check for persona switch commands
    const switchPatterns = [
      /(?:switch|change|use|activate)\s+(?:to\s+)?(?:the\s+)?(\w+)\s+(?:persona|mode|voice)/i,
      /(?:be\s+more\s+)(\w+)/i,
      /(?:let'?s?\s+be\s+)(\w+)/i
    ];
    
    for (const pattern of switchPatterns) {
      const match = lower.match(pattern);
      if (match) {
        const requested = match[1].toLowerCase();
        
        const personaManager = getPersonaManager();
        const personas = personaManager.getAllPersonas();
        
        // Find matching persona
        const found = personas.find(p => 
          p.name.toLowerCase().includes(requested) ||
          p.id.toLowerCase().includes(requested)
        );
        
        if (found) {
          this.manualSwitch(found.id, 30); // 30 minute override
          return true;
        }
      }
    }
    
    // Check for context-based keywords
    const personaManager = getPersonaManager();
    const personas = personaManager.getAllPersonas();
    
    for (const persona of personas) {
      if (persona.context.keywords) {
        for (const keyword of persona.context.keywords) {
          if (lower.includes(keyword.toLowerCase())) {
            this.evaluateContextChange({ keyword });
            return true;
          }
        }
      }
    }
    
    return false;
  }

  /**
   * Clear manual override
   */
  clearOverride(): void {
    this.manualOverride = false;
    this.overrideExpiry = null;
    logger.info('Manual override cleared');
    this.emit('override-cleared');
  }

  /**
   * Set auto-switching enabled/disabled
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    logger.info(`Context switching ${enabled ? 'enabled' : 'disabled'}`);
    this.emit('config-changed', { enabled });
  }

  /**
   * Get switch history
   */
  getHistory(limit?: number): PersonaSwitch[] {
    return limit ? this.switchHistory.slice(-limit) : [...this.switchHistory];
  }

  /**
   * Get current override status
   */
  getOverrideStatus(): { active: boolean; expiresAt: Date | null } {
    return {
      active: this.manualOverride && this.overrideExpiry !== null && this.overrideExpiry > new Date(),
      expiresAt: this.overrideExpiry
    };
  }

  getStatus(): {
    initialized: boolean;
    enabled: boolean;
    overrideActive: boolean;
    historyCount: number;
  } {
    return {
      initialized: this.initialized,
      enabled: this.config.enabled,
      overrideActive: this.getOverrideStatus().active,
      historyCount: this.switchHistory.length
    };
  }
}

// Singleton instance
let contextSwitcher: ContextSwitcher | null = null;

export function getContextSwitcher(): ContextSwitcher {
  if (!contextSwitcher) {
    contextSwitcher = new ContextSwitcher();
  }
  return contextSwitcher;
}

export { ContextSwitcher };
