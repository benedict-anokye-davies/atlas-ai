/**
 * @fileoverview WorldBox Evolutionary Observer
 * @module vm-agent/worldbox/evolutionary-observer
 * 
 * @description
 * Advanced observation and learning system for WorldBox simulations.
 * This module allows Atlas to observe civilizations rise and fall,
 * learning emergent patterns about evolution, competition, and survival.
 * 
 * Key capabilities:
 * - Civilization tracking (population, territory, technology)
 * - Species behavior analysis (aggression, cooperation, migration)
 * - Resource flow monitoring
 * - Event detection (wars, plagues, disasters)
 * - Pattern recognition (what leads to thriving vs extinction)
 * - Lesson extraction for Atlas's worldview
 * 
 * @example
 * ```typescript
 * const observer = getEvolutionaryObserver();
 * await observer.startObservation(screenState);
 * 
 * // After simulation runs...
 * const insights = observer.extractInsights();
 * console.log(insights.survivalFactors);
 * console.log(insights.extinctionPatterns);
 * ```
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { WorldBoxGameState, ScreenState, UIElement } from '../types';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const logger = createModuleLogger('WorldBoxEvolutionaryObserver');

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Tracked civilization/species in the simulation
 */
export interface TrackedCivilization {
  id: string;
  species: string;
  firstSeen: number;
  lastSeen: number;
  
  // Population tracking
  population: {
    current: number;
    peak: number;
    history: Array<{ timestamp: number; count: number }>;
  };
  
  // Territory
  territory: {
    currentSize: number;
    peakSize: number;
    expansionRate: number;
    biomes: string[];
  };
  
  // Behavior analysis
  behavior: {
    aggressionScore: number;      // 0-100
    cooperationScore: number;     // 0-100
    migrationFrequency: number;   // Events per game-hour
    buildingActivity: number;     // Structures built
    warParticipation: number;     // Wars involved in
  };
  
  // Technology/Development
  development: {
    toolsObserved: string[];
    buildingsObserved: string[];
    advancementLevel: 'primitive' | 'developing' | 'advanced' | 'civilized';
  };
  
  // Relationships
  relationships: Map<string, {
    civId: string;
    type: 'ally' | 'enemy' | 'neutral' | 'trading';
    strength: number;
    history: Array<{ timestamp: number; event: string }>;
  }>;
  
  // Status
  status: 'thriving' | 'stable' | 'declining' | 'critical' | 'extinct';
  extinctAt?: number;
  extinctionCause?: string;
}

/**
 * Global event in the simulation
 */
export interface SimulationEvent {
  id: string;
  timestamp: number;
  gameAge: number;
  type: 'war' | 'peace' | 'plague' | 'famine' | 'disaster' | 'migration' | 'extinction' | 'discovery' | 'alliance' | 'betrayal';
  participants: string[];
  location?: { x: number; y: number; region: string };
  outcome?: string;
  casualties?: number;
  significance: 'minor' | 'moderate' | 'major' | 'catastrophic';
}

/**
 * Extracted evolutionary insight
 */
export interface EvolutionaryInsight {
  id: string;
  category: 'survival' | 'competition' | 'cooperation' | 'adaptation' | 'extinction' | 'emergence';
  observation: string;
  evidence: string[];
  confidence: number;
  applicableBeyondGame: boolean;
  realWorldParallel?: string;
  timestamp: number;
}

/**
 * World state snapshot
 */
export interface WorldSnapshot {
  timestamp: number;
  gameAge: number;
  totalPopulation: number;
  activeCivilizations: number;
  extinctCivilizations: number;
  dominantSpecies: string;
  resourceAbundance: number;
  conflictLevel: number;
  stabilityIndex: number;
  biomeDistribution: Map<string, number>;
}

/**
 * Observation session
 */
export interface ObservationSession {
  id: string;
  startTime: number;
  endTime?: number;
  snapshots: WorldSnapshot[];
  events: SimulationEvent[];
  civilizations: Map<string, TrackedCivilization>;
  insights: EvolutionaryInsight[];
  observationMode: 'passive' | 'active' | 'experimental';
  hypothesis?: string;
}

// =============================================================================
// Constants
// =============================================================================

const OBSERVATION_CONSTANTS = {
  /** Snapshot interval in ms */
  SNAPSHOT_INTERVAL_MS: 5000,
  /** Max snapshots per session */
  MAX_SNAPSHOTS: 1000,
  /** Population change threshold to trigger event */
  POPULATION_CHANGE_THRESHOLD: 0.1,
  /** Minimum confidence for insight generation */
  MIN_INSIGHT_CONFIDENCE: 0.6,
  /** Data directory */
  DATA_DIR: 'worldbox-observations',
} as const;

// =============================================================================
// Species Detection Patterns
// =============================================================================

/**
 * Known WorldBox species and their visual indicators
 */
const SPECIES_INDICATORS: Record<string, string[]> = {
  human: ['village', 'house', 'farm', 'human', 'person', 'kingdom'],
  elf: ['elf', 'elven', 'tree house', 'nature'],
  orc: ['orc', 'orc camp', 'war camp'],
  dwarf: ['dwarf', 'mine', 'mountain home'],
  demon: ['demon', 'hell', 'fire', 'dark'],
  zombie: ['zombie', 'undead', 'corpse'],
  skeleton: ['skeleton', 'bone'],
  dragon: ['dragon', 'fire breath', 'flying'],
  animal: ['wolf', 'bear', 'deer', 'rabbit', 'sheep'],
};

/**
 * Biome detection patterns
 */
const BIOME_INDICATORS: Record<string, string[]> = {
  grassland: ['grass', 'green', 'plains'],
  forest: ['tree', 'forest', 'woods'],
  desert: ['sand', 'desert', 'dune'],
  snow: ['snow', 'ice', 'frozen', 'tundra'],
  swamp: ['swamp', 'marsh', 'murky'],
  mountain: ['mountain', 'rock', 'cliff'],
  ocean: ['water', 'ocean', 'sea'],
};

// =============================================================================
// Evolutionary Observer Class
// =============================================================================

/**
 * Observes and learns from WorldBox simulations
 */
export class EvolutionaryObserver extends EventEmitter {
  private currentSession: ObservationSession | null = null;
  private observationInterval: NodeJS.Timeout | null = null;
  private dataDir: string;
  private isObserving = false;
  
  // Accumulated learning across all sessions
  private cumulativeInsights: EvolutionaryInsight[] = [];
  private survivalPatterns: Map<string, number> = new Map();
  private extinctionPatterns: Map<string, number> = new Map();
  
  constructor() {
    super();
    this.dataDir = path.join(app.getPath('userData'), OBSERVATION_CONSTANTS.DATA_DIR);
    this.ensureDataDir();
    this.loadCumulativeKnowledge();
  }
  
  // ===========================================================================
  // Observation Control
  // ===========================================================================
  
  /**
   * Start observing a WorldBox simulation
   */
  async startObservation(
    initialState: ScreenState,
    mode: 'passive' | 'active' | 'experimental' = 'passive',
    hypothesis?: string
  ): Promise<string> {
    if (this.isObserving) {
      logger.warn('Already observing, stopping previous session');
      await this.stopObservation();
    }
    
    const sessionId = `obs-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    this.currentSession = {
      id: sessionId,
      startTime: Date.now(),
      snapshots: [],
      events: [],
      civilizations: new Map(),
      insights: [],
      observationMode: mode,
      hypothesis,
    };
    
    this.isObserving = true;
    
    // Take initial snapshot
    await this.takeSnapshot(initialState);
    
    // Start continuous observation
    this.observationInterval = setInterval(() => {
      this.emit('snapshot-needed');
    }, OBSERVATION_CONSTANTS.SNAPSHOT_INTERVAL_MS);
    
    logger.info('Started evolutionary observation', { 
      sessionId, 
      mode, 
      hypothesis 
    });
    
    this.emit('observation:started', sessionId);
    return sessionId;
  }
  
  /**
   * Stop observing and finalize session
   */
  async stopObservation(): Promise<ObservationSession | null> {
    if (!this.isObserving || !this.currentSession) {
      return null;
    }
    
    if (this.observationInterval) {
      clearInterval(this.observationInterval);
      this.observationInterval = null;
    }
    
    this.isObserving = false;
    this.currentSession.endTime = Date.now();
    
    // Generate final insights
    await this.generateSessionInsights();
    
    // Save session data
    await this.saveSession(this.currentSession);
    
    // Update cumulative knowledge
    this.updateCumulativeKnowledge();
    
    const session = this.currentSession;
    this.currentSession = null;
    
    logger.info('Stopped evolutionary observation', { 
      sessionId: session.id,
      duration: session.endTime! - session.startTime,
      snapshots: session.snapshots.length,
      events: session.events.length,
      insights: session.insights.length,
    });
    
    this.emit('observation:stopped', session);
    return session;
  }
  
  /**
   * Process a new screen state during observation
   */
  async processScreenUpdate(screenState: ScreenState, gameState?: WorldBoxGameState): Promise<void> {
    if (!this.isObserving || !this.currentSession) {
      return;
    }
    
    await this.takeSnapshot(screenState, gameState);
    await this.detectEvents(screenState, gameState);
    await this.updateCivilizations(screenState, gameState);
    
    // Check for insights after each update
    if (this.currentSession.snapshots.length % 10 === 0) {
      await this.generateIncrementalInsights();
    }
  }
  
  // ===========================================================================
  // Snapshot & Data Collection
  // ===========================================================================
  
  private async takeSnapshot(screenState: ScreenState, gameState?: WorldBoxGameState): Promise<void> {
    if (!this.currentSession) return;
    
    if (this.currentSession.snapshots.length >= OBSERVATION_CONSTANTS.MAX_SNAPSHOTS) {
      // Prune old snapshots, keeping every 10th for history
      this.currentSession.snapshots = this.currentSession.snapshots.filter((_, i) => i % 10 === 0);
    }
    
    const snapshot: WorldSnapshot = {
      timestamp: Date.now(),
      gameAge: gameState?.worldAge || this.currentSession.snapshots.length,
      totalPopulation: this.estimatePopulation(screenState, gameState),
      activeCivilizations: this.currentSession.civilizations.size,
      extinctCivilizations: Array.from(this.currentSession.civilizations.values())
        .filter(c => c.status === 'extinct').length,
      dominantSpecies: this.findDominantSpecies(),
      resourceAbundance: this.estimateResources(screenState),
      conflictLevel: this.estimateConflict(),
      stabilityIndex: this.calculateStability(),
      biomeDistribution: this.analyzeBiomes(screenState),
    };
    
    this.currentSession.snapshots.push(snapshot);
    this.emit('snapshot:taken', snapshot);
  }
  
  private estimatePopulation(screenState: ScreenState, gameState?: WorldBoxGameState): number {
    // Use game state if available
    if (gameState?.creatureCount) {
      return gameState.creatureCount;
    }
    
    // Otherwise estimate from screen elements
    let count = 0;
    for (const region of screenState.textRegions) {
      // Look for population indicators in UI
      const text = region.text.toLowerCase();
      const match = text.match(/population[:\s]*(\d+)/i) || text.match(/(\d+)\s*creatures/i);
      if (match) {
        count = Math.max(count, parseInt(match[1], 10));
      }
    }
    return count;
  }
  
  private estimateResources(screenState: ScreenState): number {
    // Analyze screen for resource indicators (green = abundant, barren = scarce)
    let greenCount = 0;
    const totalRegions = screenState.textRegions.length || 1;
    
    for (const region of screenState.textRegions) {
      const text = region.text.toLowerCase();
      if (BIOME_INDICATORS.grassland.some(ind => text.includes(ind)) ||
          BIOME_INDICATORS.forest.some(ind => text.includes(ind))) {
        greenCount++;
      }
    }
    
    return (greenCount / totalRegions) * 100;
  }
  
  private estimateConflict(): number {
    if (!this.currentSession) return 0;
    
    // Count recent war events
    const recentEvents = this.currentSession.events.filter(
      e => e.timestamp > Date.now() - 60000 && e.type === 'war'
    );
    
    return Math.min(100, recentEvents.length * 20);
  }
  
  private calculateStability(): number {
    if (!this.currentSession || this.currentSession.snapshots.length < 2) {
      return 50;
    }
    
    // Compare recent population changes
    const recent = this.currentSession.snapshots.slice(-5);
    if (recent.length < 2) return 50;
    
    const changes = [];
    for (let i = 1; i < recent.length; i++) {
      const change = Math.abs(recent[i].totalPopulation - recent[i-1].totalPopulation);
      const pctChange = recent[i-1].totalPopulation > 0 
        ? (change / recent[i-1].totalPopulation) * 100 
        : 0;
      changes.push(pctChange);
    }
    
    const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
    return Math.max(0, 100 - avgChange * 10);
  }
  
  private analyzeBiomes(screenState: ScreenState): Map<string, number> {
    const distribution = new Map<string, number>();
    
    for (const region of screenState.textRegions) {
      const text = region.text.toLowerCase();
      for (const [biome, indicators] of Object.entries(BIOME_INDICATORS)) {
        if (indicators.some(ind => text.includes(ind))) {
          distribution.set(biome, (distribution.get(biome) || 0) + 1);
        }
      }
    }
    
    return distribution;
  }
  
  private findDominantSpecies(): string {
    if (!this.currentSession) return 'unknown';
    
    let maxPop = 0;
    let dominant = 'unknown';
    
    for (const [_, civ] of this.currentSession.civilizations) {
      if (civ.population.current > maxPop && civ.status !== 'extinct') {
        maxPop = civ.population.current;
        dominant = civ.species;
      }
    }
    
    return dominant;
  }
  
  // ===========================================================================
  // Event Detection
  // ===========================================================================
  
  private async detectEvents(screenState: ScreenState, gameState?: WorldBoxGameState): Promise<void> {
    if (!this.currentSession) return;
    
    const gameAge = gameState?.worldAge || this.currentSession.snapshots.length;
    
    // Analyze text for events
    for (const region of screenState.textRegions) {
      const text = region.text.toLowerCase();
      
      // War detection
      if (text.includes('war') || text.includes('attack') || text.includes('battle')) {
        this.recordEvent('war', [], gameAge, region.text, 'moderate');
      }
      
      // Peace detection
      if (text.includes('peace') || text.includes('alliance') || text.includes('treaty')) {
        this.recordEvent('alliance', [], gameAge, region.text, 'moderate');
      }
      
      // Disaster detection
      if (text.includes('earthquake') || text.includes('meteor') || text.includes('tornado') ||
          text.includes('plague') || text.includes('fire') || text.includes('flood')) {
        const type = text.includes('plague') ? 'plague' : 'disaster';
        this.recordEvent(type, [], gameAge, region.text, 'major');
      }
      
      // Extinction detection
      if (text.includes('extinct') || text.includes('died out') || text.includes('no more')) {
        this.recordEvent('extinction', [], gameAge, region.text, 'catastrophic');
      }
    }
    
    // Check for population collapse
    if (this.currentSession.snapshots.length >= 2) {
      const prev = this.currentSession.snapshots[this.currentSession.snapshots.length - 2];
      const curr = this.currentSession.snapshots[this.currentSession.snapshots.length - 1];
      
      if (prev.totalPopulation > 0) {
        const change = (curr.totalPopulation - prev.totalPopulation) / prev.totalPopulation;
        if (change < -OBSERVATION_CONSTANTS.POPULATION_CHANGE_THRESHOLD) {
          this.recordEvent('disaster', [], gameAge, `Population dropped by ${Math.abs(change * 100).toFixed(1)}%`, 'major');
        }
      }
    }
  }
  
  private recordEvent(
    type: SimulationEvent['type'],
    participants: string[],
    gameAge: number,
    outcome: string,
    significance: SimulationEvent['significance']
  ): void {
    if (!this.currentSession) return;
    
    const event: SimulationEvent = {
      id: `event-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      timestamp: Date.now(),
      gameAge,
      type,
      participants,
      outcome,
      significance,
    };
    
    this.currentSession.events.push(event);
    this.emit('event:detected', event);
    
    logger.debug('Event detected', { type, significance, outcome });
  }
  
  // ===========================================================================
  // Civilization Tracking
  // ===========================================================================
  
  private async updateCivilizations(screenState: ScreenState, gameState?: WorldBoxGameState): Promise<void> {
    if (!this.currentSession) return;
    
    // Detect species from screen
    const detectedSpecies = new Set<string>();
    
    for (const region of screenState.textRegions) {
      const text = region.text.toLowerCase();
      for (const [species, indicators] of Object.entries(SPECIES_INDICATORS)) {
        if (indicators.some(ind => text.includes(ind))) {
          detectedSpecies.add(species);
        }
      }
    }
    
    // Update or create civilizations
    for (const species of detectedSpecies) {
      const civId = `${species}-civ`;
      let civ = this.currentSession.civilizations.get(civId);
      
      if (!civ) {
        // New civilization discovered
        civ = this.createNewCivilization(civId, species);
        this.currentSession.civilizations.set(civId, civ);
        this.emit('civilization:discovered', civ);
        logger.info('New civilization discovered', { species, civId });
      }
      
      // Update civilization state
      civ.lastSeen = Date.now();
      this.updateCivilizationMetrics(civ, screenState);
    }
    
    // Check for extinctions
    for (const [civId, civ] of this.currentSession.civilizations) {
      if (civ.status !== 'extinct' && 
          Date.now() - civ.lastSeen > 30000 && // Not seen for 30 seconds
          !detectedSpecies.has(civ.species)) {
        civ.status = 'extinct';
        civ.extinctAt = Date.now();
        civ.extinctionCause = this.inferExtinctionCause(civ);
        
        // Track extinction pattern
        const pattern = civ.extinctionCause || 'unknown';
        this.extinctionPatterns.set(pattern, (this.extinctionPatterns.get(pattern) || 0) + 1);
        
        this.emit('civilization:extinct', civ);
        logger.info('Civilization went extinct', { 
          species: civ.species, 
          cause: civ.extinctionCause 
        });
      }
    }
  }
  
  private createNewCivilization(id: string, species: string): TrackedCivilization {
    return {
      id,
      species,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      population: {
        current: 0,
        peak: 0,
        history: [],
      },
      territory: {
        currentSize: 0,
        peakSize: 0,
        expansionRate: 0,
        biomes: [],
      },
      behavior: {
        aggressionScore: 50,
        cooperationScore: 50,
        migrationFrequency: 0,
        buildingActivity: 0,
        warParticipation: 0,
      },
      development: {
        toolsObserved: [],
        buildingsObserved: [],
        advancementLevel: 'primitive',
      },
      relationships: new Map(),
      status: 'stable',
    };
  }
  
  private updateCivilizationMetrics(civ: TrackedCivilization, screenState: ScreenState): void {
    // Update population from screen analysis
    // This would need more sophisticated vision analysis in production
    
    // Update status based on population trend
    if (civ.population.history.length >= 3) {
      const recent = civ.population.history.slice(-3);
      const trend = recent[2].count - recent[0].count;
      
      if (trend > 10) {
        civ.status = 'thriving';
      } else if (trend > 0) {
        civ.status = 'stable';
      } else if (trend > -10) {
        civ.status = 'declining';
      } else {
        civ.status = 'critical';
      }
    }
  }
  
  private inferExtinctionCause(civ: TrackedCivilization): string {
    if (!this.currentSession) return 'unknown';
    
    // Look at recent events for this civilization
    const recentEvents = this.currentSession.events.filter(
      e => e.timestamp > civ.firstSeen && 
           (e.participants.includes(civ.species) || e.participants.length === 0)
    );
    
    // Check for war
    const warEvents = recentEvents.filter(e => e.type === 'war');
    if (warEvents.length > 0) {
      return 'war/conquest';
    }
    
    // Check for disaster
    const disasterEvents = recentEvents.filter(e => e.type === 'disaster' || e.type === 'plague');
    if (disasterEvents.length > 0) {
      return disasterEvents[0].type;
    }
    
    // Check for resource depletion (low resources + declining)
    const lastSnapshot = this.currentSession.snapshots[this.currentSession.snapshots.length - 1];
    if (lastSnapshot && lastSnapshot.resourceAbundance < 20) {
      return 'resource_depletion';
    }
    
    // Competition
    if (this.currentSession.civilizations.size > 1) {
      return 'competition';
    }
    
    return 'unknown';
  }
  
  // ===========================================================================
  // Insight Generation
  // ===========================================================================
  
  private async generateIncrementalInsights(): Promise<void> {
    if (!this.currentSession) return;
    
    // Analyze current state for patterns
    const snapshots = this.currentSession.snapshots;
    if (snapshots.length < 5) return;
    
    // Check for cooperation vs competition patterns
    const cooperationInsight = this.analyzeCooperationPattern();
    if (cooperationInsight) {
      this.currentSession.insights.push(cooperationInsight);
      this.emit('insight:generated', cooperationInsight);
    }
    
    // Check for survival patterns
    const survivalInsight = this.analyzeSurvivalPattern();
    if (survivalInsight) {
      this.currentSession.insights.push(survivalInsight);
      this.emit('insight:generated', survivalInsight);
    }
  }
  
  private async generateSessionInsights(): Promise<void> {
    if (!this.currentSession) return;
    
    const session = this.currentSession;
    
    // Overall session analysis
    
    // 1. What led to thriving vs extinction
    const survivors = Array.from(session.civilizations.values()).filter(c => c.status !== 'extinct');
    const extinct = Array.from(session.civilizations.values()).filter(c => c.status === 'extinct');
    
    if (survivors.length > 0 && extinct.length > 0) {
      const insight: EvolutionaryInsight = {
        id: `insight-${Date.now()}-survival`,
        category: 'survival',
        observation: `Survivors: ${survivors.map(s => s.species).join(', ')}. Extinct: ${extinct.map(e => e.species).join(', ')}`,
        evidence: [
          `${survivors.length} civilizations survived`,
          `${extinct.length} civilizations went extinct`,
          ...extinct.map(e => `${e.species} extinction cause: ${e.extinctionCause}`),
        ],
        confidence: 0.8,
        applicableBeyondGame: true,
        realWorldParallel: 'Resource management and adaptability are key to long-term survival',
        timestamp: Date.now(),
      };
      session.insights.push(insight);
    }
    
    // 2. Resource-population relationship
    if (session.snapshots.length > 10) {
      const resourcePopCorrelation = this.calculateCorrelation(
        session.snapshots.map(s => s.resourceAbundance),
        session.snapshots.map(s => s.totalPopulation)
      );
      
      if (Math.abs(resourcePopCorrelation) > 0.5) {
        const insight: EvolutionaryInsight = {
          id: `insight-${Date.now()}-resources`,
          category: 'adaptation',
          observation: resourcePopCorrelation > 0 
            ? 'Population grows with resource abundance' 
            : 'Population inversely correlated with resources (overconsumption)',
          evidence: [
            `Correlation coefficient: ${resourcePopCorrelation.toFixed(2)}`,
            `Analyzed ${session.snapshots.length} time points`,
          ],
          confidence: Math.min(0.9, Math.abs(resourcePopCorrelation)),
          applicableBeyondGame: true,
          realWorldParallel: 'Carrying capacity limits population growth',
          timestamp: Date.now(),
        };
        session.insights.push(insight);
      }
    }
    
    // 3. Conflict impact analysis
    const warEvents = session.events.filter(e => e.type === 'war');
    if (warEvents.length > 0) {
      const insight: EvolutionaryInsight = {
        id: `insight-${Date.now()}-conflict`,
        category: 'competition',
        observation: `${warEvents.length} wars occurred. ${extinct.filter(e => e.extinctionCause === 'war/conquest').length} civilizations fell to war.`,
        evidence: warEvents.map(w => w.outcome || 'War event'),
        confidence: 0.85,
        applicableBeyondGame: true,
        realWorldParallel: 'Conflict can accelerate both extinction and evolutionary pressure',
        timestamp: Date.now(),
      };
      session.insights.push(insight);
    }
    
    logger.info('Generated session insights', { 
      count: session.insights.length 
    });
  }
  
  private analyzeCooperationPattern(): EvolutionaryInsight | null {
    if (!this.currentSession) return null;
    
    const allianceEvents = this.currentSession.events.filter(e => e.type === 'alliance' || e.type === 'peace');
    const warEvents = this.currentSession.events.filter(e => e.type === 'war');
    
    if (allianceEvents.length + warEvents.length < 3) return null;
    
    const cooperationRatio = allianceEvents.length / (allianceEvents.length + warEvents.length);
    
    if (cooperationRatio > 0.7) {
      return {
        id: `insight-${Date.now()}-coop`,
        category: 'cooperation',
        observation: 'High cooperation environment - civilizations forming alliances',
        evidence: [
          `${allianceEvents.length} alliance/peace events`,
          `${warEvents.length} war events`,
          `Cooperation ratio: ${(cooperationRatio * 100).toFixed(1)}%`,
        ],
        confidence: cooperationRatio,
        applicableBeyondGame: true,
        realWorldParallel: 'Cooperation often emerges when mutual benefits outweigh competition gains',
        timestamp: Date.now(),
      };
    } else if (cooperationRatio < 0.3) {
      return {
        id: `insight-${Date.now()}-comp`,
        category: 'competition',
        observation: 'High conflict environment - civilizations competing intensely',
        evidence: [
          `${warEvents.length} war events`,
          `${allianceEvents.length} alliance/peace events`,
          `Conflict ratio: ${((1 - cooperationRatio) * 100).toFixed(1)}%`,
        ],
        confidence: 1 - cooperationRatio,
        applicableBeyondGame: true,
        realWorldParallel: 'Scarcity or territorial pressure often drives conflict over cooperation',
        timestamp: Date.now(),
      };
    }
    
    return null;
  }
  
  private analyzeSurvivalPattern(): EvolutionaryInsight | null {
    if (!this.currentSession) return null;
    
    const civs = Array.from(this.currentSession.civilizations.values());
    const surviving = civs.filter(c => c.status !== 'extinct');
    
    if (surviving.length === 0 || civs.length < 2) return null;
    
    // Analyze what surviving civilizations have in common
    const commonTraits: string[] = [];
    
    // Check aggression levels
    const avgAggression = surviving.reduce((sum, c) => sum + c.behavior.aggressionScore, 0) / surviving.length;
    if (avgAggression < 40) {
      commonTraits.push('low aggression');
    } else if (avgAggression > 70) {
      commonTraits.push('high aggression');
    }
    
    // Check cooperation levels
    const avgCooperation = surviving.reduce((sum, c) => sum + c.behavior.cooperationScore, 0) / surviving.length;
    if (avgCooperation > 60) {
      commonTraits.push('high cooperation');
    }
    
    if (commonTraits.length > 0) {
      return {
        id: `insight-${Date.now()}-survival`,
        category: 'survival',
        observation: `Surviving civilizations share: ${commonTraits.join(', ')}`,
        evidence: surviving.map(c => `${c.species}: survived with ${c.status} status`),
        confidence: 0.7,
        applicableBeyondGame: true,
        realWorldParallel: 'Balanced strategies often outperform extremes in complex environments',
        timestamp: Date.now(),
      };
    }
    
    return null;
  }
  
  // ===========================================================================
  // Utility Methods
  // ===========================================================================
  
  private calculateCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n < 2) return 0;
    
    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;
    
    let numerator = 0;
    let denomX = 0;
    let denomY = 0;
    
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      numerator += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }
    
    const denom = Math.sqrt(denomX * denomY);
    return denom === 0 ? 0 : numerator / denom;
  }
  
  // ===========================================================================
  // Persistence
  // ===========================================================================
  
  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }
  
  private async saveSession(session: ObservationSession): Promise<void> {
    const filename = path.join(this.dataDir, `session-${session.id}.json`);
    
    // Convert Maps to objects for JSON serialization
    const serializable = {
      ...session,
      civilizations: Object.fromEntries(session.civilizations),
      snapshots: session.snapshots.map(s => ({
        ...s,
        biomeDistribution: Object.fromEntries(s.biomeDistribution),
      })),
    };
    
    fs.writeFileSync(filename, JSON.stringify(serializable, null, 2));
    logger.info('Saved observation session', { filename });
  }
  
  private loadCumulativeKnowledge(): void {
    const knowledgeFile = path.join(this.dataDir, 'cumulative-knowledge.json');
    
    if (fs.existsSync(knowledgeFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(knowledgeFile, 'utf-8'));
        this.cumulativeInsights = data.insights || [];
        this.survivalPatterns = new Map(Object.entries(data.survivalPatterns || {}));
        this.extinctionPatterns = new Map(Object.entries(data.extinctionPatterns || {}));
        logger.info('Loaded cumulative knowledge', {
          insights: this.cumulativeInsights.length,
          survivalPatterns: this.survivalPatterns.size,
          extinctionPatterns: this.extinctionPatterns.size,
        });
      } catch (error) {
        logger.warn('Failed to load cumulative knowledge', { error: (error as Error).message });
      }
    }
  }
  
  private updateCumulativeKnowledge(): void {
    if (!this.currentSession) return;
    
    // Add session insights to cumulative
    this.cumulativeInsights.push(...this.currentSession.insights);
    
    // Keep only most recent insights
    if (this.cumulativeInsights.length > 100) {
      this.cumulativeInsights = this.cumulativeInsights.slice(-100);
    }
    
    // Save cumulative knowledge
    const knowledgeFile = path.join(this.dataDir, 'cumulative-knowledge.json');
    const data = {
      insights: this.cumulativeInsights,
      survivalPatterns: Object.fromEntries(this.survivalPatterns),
      extinctionPatterns: Object.fromEntries(this.extinctionPatterns),
      lastUpdated: Date.now(),
    };
    
    fs.writeFileSync(knowledgeFile, JSON.stringify(data, null, 2));
    logger.info('Updated cumulative knowledge');
  }
  
  // ===========================================================================
  // Public API
  // ===========================================================================
  
  /**
   * Get all insights from this and previous sessions
   */
  getInsights(): EvolutionaryInsight[] {
    const currentInsights = this.currentSession?.insights || [];
    return [...this.cumulativeInsights, ...currentInsights];
  }
  
  /**
   * Get survival pattern statistics
   */
  getSurvivalPatterns(): Record<string, number> {
    return Object.fromEntries(this.survivalPatterns);
  }
  
  /**
   * Get extinction pattern statistics  
   */
  getExtinctionPatterns(): Record<string, number> {
    return Object.fromEntries(this.extinctionPatterns);
  }
  
  /**
   * Get current observation status
   */
  getStatus(): {
    isObserving: boolean;
    sessionId?: string;
    duration?: number;
    snapshots?: number;
    events?: number;
    civilizations?: number;
  } {
    if (!this.isObserving || !this.currentSession) {
      return { isObserving: false };
    }
    
    return {
      isObserving: true,
      sessionId: this.currentSession.id,
      duration: Date.now() - this.currentSession.startTime,
      snapshots: this.currentSession.snapshots.length,
      events: this.currentSession.events.length,
      civilizations: this.currentSession.civilizations.size,
    };
  }
  
  /**
   * Get evolutionary wisdom for Atlas's responses
   */
  getEvolutionaryWisdom(): string[] {
    const wisdom: string[] = [];
    
    // Extract key learnings from insights
    for (const insight of this.cumulativeInsights.slice(-10)) {
      if (insight.realWorldParallel && insight.confidence > 0.7) {
        wisdom.push(insight.realWorldParallel);
      }
    }
    
    // Add pattern-based wisdom
    const topExtinctionCause = [...this.extinctionPatterns.entries()]
      .sort((a, b) => b[1] - a[1])[0];
    if (topExtinctionCause) {
      wisdom.push(`Most common extinction cause observed: ${topExtinctionCause[0]} (${topExtinctionCause[1]} instances)`);
    }
    
    return wisdom;
  }
}

// =============================================================================
// Singleton Management
// =============================================================================

let instance: EvolutionaryObserver | null = null;

/**
 * Get the singleton EvolutionaryObserver instance
 */
export function getEvolutionaryObserver(): EvolutionaryObserver {
  if (!instance) {
    instance = new EvolutionaryObserver();
  }
  return instance;
}

/**
 * Shutdown the observer
 */
export async function shutdownEvolutionaryObserver(): Promise<void> {
  if (instance) {
    await instance.stopObservation();
    instance = null;
  }
}
