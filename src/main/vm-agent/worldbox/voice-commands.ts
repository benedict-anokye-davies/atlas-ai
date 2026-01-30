/**
 * @fileoverview WorldBox Voice Commands for Atlas
 * @module vm-agent/worldbox/voice-commands
 * 
 * @description
 * Natural language command processing for WorldBox interactions.
 * Enables voice-first control of WorldBox simulations.
 * 
 * @example
 * "Atlas, start observing WorldBox and tell me what you learn"
 * "Spawn some humans near the forest"
 * "What's happening with the elves?"
 * "Why did the orcs go extinct?"
 * "Create a new world and let it run for a while"
 */

import { createModuleLogger } from '../../utils/logger';
import { getEvolutionaryObserver, EvolutionaryInsight } from './evolutionary-observer';
import { getVMAgent } from '../index';
import { WorldBoxGameState } from '../types';

const logger = createModuleLogger('WorldBoxVoiceCommands');

// =============================================================================
// Command Patterns
// =============================================================================

/**
 * Pattern matching for WorldBox voice commands
 */
const COMMAND_PATTERNS = {
  // Observation commands
  startObserving: /start\s*(observing|watching|monitoring|learning)/i,
  stopObserving: /stop\s*(observing|watching|monitoring|learning)/i,
  whatLearned: /(what|tell me|share).*(learn|discover|observe)/i,
  getInsights: /(insights?|wisdom|lessons?|observations?)/i,
  
  // Creature commands
  spawnCreature: /spawn\s*(some|a|an|few|many)?\s*(humans?|elves?|orcs?|dwarves?|demons?|dragons?|zombies?)/i,
  
  // World commands
  createWorld: /(create|new|generate)\s*(a\s*)?(new\s*)?(world|map)/i,
  loadWorld: /load\s*(world|map|save)/i,
  saveWorld: /save\s*(world|map|game)/i,
  
  // Tool commands
  selectTool: /(select|use|choose|pick)\s*(the\s*)?(\w+)\s*(tool)?/i,
  
  // Time commands
  pauseGame: /(pause|stop|freeze)\s*(time|game|simulation)?/i,
  resumeGame: /(resume|continue|unpause|play)\s*(time|game|simulation)?/i,
  speedUp: /(speed\s*up|faster|increase\s*speed)/i,
  slowDown: /(slow\s*down|slower|decrease\s*speed)/i,
  
  // Query commands
  getStatus: /(what'?s?\s*happening|status|state|current)/i,
  whyExtinct: /why\s*did\s*(the\s*)?(\w+)\s*(go\s*)?(extinct|die)/i,
  populationQuery: /(how\s*many|population|count)\s*(humans?|elves?|orcs?|creatures?)?/i,
  
  // Analysis commands
  analyzeWorld: /(analyze|analyse|study|examine)\s*(the\s*)?(world|simulation|civilizations?)/i,
  compareCivs: /compare\s*(the\s*)?(civilizations?|species|races)/i,
  
  // Disaster commands
  causeDisaster: /(cause|trigger|send|unleash)\s*(a\s*)?(earthquake|meteor|tornado|plague|fire|flood|disaster)/i,
};

// =============================================================================
// Command Processor
// =============================================================================

export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
  voiceResponse: string;
}

/**
 * Process a natural language WorldBox command
 */
export async function processWorldBoxCommand(command: string): Promise<CommandResult> {
  logger.info('Processing WorldBox command', { command });
  
  const vmAgent = getVMAgent();
  const observer = getEvolutionaryObserver();
  
  // Check if WorldBox is running
  const { isRunning, gameState } = await vmAgent.checkWorldBox();
  
  // === OBSERVATION COMMANDS ===
  
  if (COMMAND_PATTERNS.startObserving.test(command)) {
    if (!isRunning) {
      return {
        success: false,
        message: 'WorldBox is not running',
        voiceResponse: "I can't see WorldBox running. Can you start the game first?",
      };
    }
    
    const screenState = await vmAgent.captureScreen();
    const sessionId = await observer.startObservation(screenState, 'active');
    
    return {
      success: true,
      message: `Started observation session ${sessionId}`,
      data: { sessionId },
      voiceResponse: "I'm now watching the WorldBox simulation. I'll learn from how civilizations evolve, compete, and survive. Let me know when you want my observations.",
    };
  }
  
  if (COMMAND_PATTERNS.stopObserving.test(command)) {
    const session = await observer.stopObservation();
    if (!session) {
      return {
        success: false,
        message: 'No active observation',
        voiceResponse: "I wasn't actively observing. Want me to start?",
      };
    }
    
    const insightSummary = session.insights.length > 0
      ? `I gathered ${session.insights.length} insights.`
      : 'No major patterns emerged yet.';
    
    return {
      success: true,
      message: `Stopped observation after ${session.snapshots.length} snapshots`,
      data: { session },
      voiceResponse: `I've stopped observing. In this session, I tracked ${session.civilizations.size} civilizations and witnessed ${session.events.length} events. ${insightSummary} Want to hear what I learned?`,
    };
  }
  
  if (COMMAND_PATTERNS.whatLearned.test(command) || COMMAND_PATTERNS.getInsights.test(command)) {
    const insights = observer.getInsights();
    const wisdom = observer.getEvolutionaryWisdom();
    
    if (insights.length === 0) {
      return {
        success: true,
        message: 'No insights yet',
        voiceResponse: "I haven't gathered enough observations yet. Let me watch some simulations first.",
      };
    }
    
    // Get the most impactful insights
    const topInsights = insights
      .filter(i => i.confidence > 0.6)
      .slice(-3)
      .map(i => i.observation);
    
    return {
      success: true,
      message: `Retrieved ${insights.length} insights`,
      data: { insights, wisdom },
      voiceResponse: formatInsightsForVoice(topInsights, wisdom),
    };
  }
  
  // === CREATURE COMMANDS ===
  
  const spawnMatch = command.match(COMMAND_PATTERNS.spawnCreature);
  if (spawnMatch) {
    if (!isRunning) {
      return {
        success: false,
        message: 'WorldBox not running',
        voiceResponse: "WorldBox isn't running. Start the game first.",
      };
    }
    
    const creature = spawnMatch[2].toLowerCase().replace(/s$/, ''); // Remove plural
    const result = await vmAgent.worldBoxCommand(`spawn ${creature}`);
    
    return {
      success: result.success,
      message: result.success ? `Spawned ${creature}` : result.error || 'Failed',
      data: result,
      voiceResponse: result.success
        ? `I've spawned some ${creature}s. Let's see how they do.`
        : `I couldn't spawn ${creature}s. ${result.error || 'Try selecting the right tool first.'}`,
    };
  }
  
  // === TIME COMMANDS ===
  
  if (COMMAND_PATTERNS.pauseGame.test(command)) {
    if (!isRunning) {
      return noWorldBoxResponse();
    }
    
    const result = await vmAgent.worldBoxCommand('pause');
    return {
      success: result.success,
      message: 'Game paused',
      voiceResponse: 'Paused the simulation.',
    };
  }
  
  if (COMMAND_PATTERNS.resumeGame.test(command)) {
    if (!isRunning) {
      return noWorldBoxResponse();
    }
    
    const result = await vmAgent.worldBoxCommand('play');
    return {
      success: result.success,
      message: 'Game resumed',
      voiceResponse: 'Resumed the simulation.',
    };
  }
  
  if (COMMAND_PATTERNS.speedUp.test(command)) {
    if (!isRunning) {
      return noWorldBoxResponse();
    }
    
    const result = await vmAgent.worldBoxCommand('speed up');
    return {
      success: result.success,
      message: 'Speed increased',
      voiceResponse: 'Speeding up time.',
    };
  }
  
  // === DISASTER COMMANDS ===
  
  const disasterMatch = command.match(COMMAND_PATTERNS.causeDisaster);
  if (disasterMatch) {
    if (!isRunning) {
      return noWorldBoxResponse();
    }
    
    const disaster = disasterMatch[3].toLowerCase();
    const result = await vmAgent.worldBoxCommand(`disaster ${disaster}`);
    
    return {
      success: result.success,
      message: result.success ? `Triggered ${disaster}` : result.error || 'Failed',
      voiceResponse: result.success
        ? `Unleashing ${disaster}. This will be interesting to observe.`
        : `Couldn't trigger ${disaster}. ${result.error || ''}`,
    };
  }
  
  // === QUERY COMMANDS ===
  
  if (COMMAND_PATTERNS.getStatus.test(command)) {
    const observerStatus = observer.getStatus();
    
    if (!isRunning) {
      return {
        success: true,
        message: 'WorldBox not running',
        data: { isRunning: false, observerStatus },
        voiceResponse: "WorldBox isn't running right now. Want me to help you start it?",
      };
    }
    
    const statusMsg = buildStatusMessage(gameState!, observerStatus);
    
    return {
      success: true,
      message: 'Status retrieved',
      data: { gameState, observerStatus },
      voiceResponse: statusMsg,
    };
  }
  
  const extinctMatch = command.match(COMMAND_PATTERNS.whyExtinct);
  if (extinctMatch) {
    const species = extinctMatch[2].toLowerCase();
    const patterns = observer.getExtinctionPatterns();
    
    // Look for insights about this species
    const insights = observer.getInsights().filter(i => 
      i.observation.toLowerCase().includes(species) || 
      i.evidence.some(e => e.toLowerCase().includes(species))
    );
    
    if (insights.length > 0) {
      const relevantInsight = insights[insights.length - 1];
      return {
        success: true,
        message: `Found insight about ${species}`,
        data: { insights, patterns },
        voiceResponse: `From what I observed, ${relevantInsight.observation}. ${relevantInsight.realWorldParallel || ''}`,
      };
    }
    
    // General extinction knowledge
    const topCause = Object.entries(patterns).sort((a, b) => b[1] - a[1])[0];
    if (topCause) {
      return {
        success: true,
        message: 'General extinction patterns',
        data: { patterns },
        voiceResponse: `I haven't specifically tracked ${species}, but from my observations, ${topCause[0]} is the most common cause of extinction, accounting for ${topCause[1]} cases.`,
      };
    }
    
    return {
      success: true,
      message: 'No data',
      voiceResponse: `I don't have data on ${species} extinctions yet. Let me observe more simulations.`,
    };
  }
  
  // === ANALYSIS COMMANDS ===
  
  if (COMMAND_PATTERNS.analyzeWorld.test(command)) {
    const observerStatus = observer.getStatus();
    const insights = observer.getInsights();
    const wisdom = observer.getEvolutionaryWisdom();
    
    const analysis = buildWorldAnalysis(gameState, observerStatus, insights);
    
    return {
      success: true,
      message: 'World analysis complete',
      data: { observerStatus, insights, wisdom },
      voiceResponse: analysis,
    };
  }
  
  // === FALLBACK ===
  
  // Try to execute as generic WorldBox command
  if (isRunning) {
    const result = await vmAgent.worldBoxCommand(command);
    return {
      success: result.success,
      message: result.success ? 'Command executed' : result.error || 'Failed',
      data: result,
      voiceResponse: result.success
        ? 'Done.'
        : `I couldn't do that. ${result.error || 'Try a different command.'}`,
    };
  }
  
  return {
    success: false,
    message: 'Command not recognized',
    voiceResponse: "I'm not sure what you want me to do. Try something like 'start observing', 'spawn humans', or 'what did you learn'.",
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

function noWorldBoxResponse(): CommandResult {
  return {
    success: false,
    message: 'WorldBox not running',
    voiceResponse: "WorldBox isn't running. Start the game first.",
  };
}

function formatInsightsForVoice(insights: string[], wisdom: string[]): string {
  const parts: string[] = [];
  
  if (insights.length > 0) {
    parts.push("Here's what I've learned:");
    insights.forEach((insight, i) => {
      parts.push(`${i + 1}. ${insight}`);
    });
  }
  
  if (wisdom.length > 0) {
    parts.push("And some broader patterns I've noticed:");
    wisdom.slice(0, 2).forEach(w => parts.push(w));
  }
  
  return parts.join(' ');
}

function buildStatusMessage(
  gameState: WorldBoxGameState, 
  observerStatus: ReturnType<typeof getEvolutionaryObserver['prototype']['getStatus']>
): string {
  const parts: string[] = [];
  
  if (gameState.isPaused) {
    parts.push("The simulation is paused.");
  } else {
    parts.push("The simulation is running.");
  }
  
  if (gameState.creatureCount) {
    parts.push(`There are ${gameState.creatureCount} creatures.`);
  }
  
  if (gameState.worldAge) {
    parts.push(`The world is ${gameState.worldAge} years old.`);
  }
  
  if (observerStatus.isObserving) {
    parts.push(`I'm actively observing, with ${observerStatus.snapshots} snapshots and ${observerStatus.events} events recorded.`);
  }
  
  return parts.join(' ');
}

function buildWorldAnalysis(
  gameState: WorldBoxGameState | undefined,
  observerStatus: ReturnType<typeof getEvolutionaryObserver['prototype']['getStatus']>,
  insights: EvolutionaryInsight[]
): string {
  const parts: string[] = [];
  
  if (!gameState) {
    parts.push("WorldBox isn't running, but here's what I know from previous sessions.");
  } else {
    parts.push("Looking at the current world...");
    if (gameState.creatureCount) {
      parts.push(`I see about ${gameState.creatureCount} creatures.`);
    }
  }
  
  if (observerStatus.isObserving && observerStatus.civilizations) {
    parts.push(`I'm tracking ${observerStatus.civilizations} civilizations.`);
  }
  
  // Add top insights
  const highConfidence = insights.filter(i => i.confidence > 0.7);
  if (highConfidence.length > 0) {
    parts.push("Key observations:");
    highConfidence.slice(-2).forEach(i => {
      parts.push(i.observation);
    });
  }
  
  return parts.join(' ');
}

// =============================================================================
// Registration with Agent Tools
// =============================================================================

/**
 * WorldBox command tool for LLM
 */
export const worldBoxVoiceCommand = {
  name: 'worldbox_voice_command',
  description: `Execute a natural language WorldBox command. Examples:
- "start observing" - Begin watching and learning from the simulation
- "stop observing" - Stop and get insights
- "what did you learn" - Get evolutionary insights
- "spawn humans" - Add creatures to the world
- "pause/resume" - Control simulation time
- "cause earthquake" - Trigger disasters
- "why did the orcs go extinct" - Query extinction causes
- "analyze world" - Get detailed world analysis`,
  parameters: {
    type: 'object' as const,
    properties: {
      command: {
        type: 'string',
        description: 'Natural language command for WorldBox',
      },
    },
    required: ['command'],
  },
  execute: async (params: { command: string }): Promise<CommandResult> => {
    return processWorldBoxCommand(params.command);
  },
};
