/**
 * AssociativeMemory.ts
 * 
 * Neural-like associative memory system using spreading activation
 * and Hebbian learning. Enables JARVIS to form natural connections
 * between concepts just like human memory.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { KnowledgeGraphDB, GraphNode } from './KnowledgeGraphDB';

const logger = createModuleLogger('AssociativeMemory');

// ============================================================================
// Types
// ============================================================================

export interface ActivationResult {
  concept: string;
  activation: number;
  source: 'direct' | 'spread';
  depth: number;
}

export interface AssociationStrength {
  conceptA: string;
  conceptB: string;
  strength: number;
  coActivations: number;
}

export interface MemoryTrace {
  concepts: string[];
  timestamp: number;
  strength: number;
}

export interface AssociativeMemoryConfig {
  spreadingDecay: number;        // How much activation decays per hop (0-1)
  activationThreshold: number;   // Minimum activation to spread further
  maxSpreadDepth: number;        // Maximum hops for spreading activation
  hebbianLearningRate: number;   // Rate of association strengthening
  baseDecayRate: number;         // Base decay rate for associations
}

const DEFAULT_CONFIG: AssociativeMemoryConfig = {
  spreadingDecay: 0.5,
  activationThreshold: 0.1,
  maxSpreadDepth: 3,
  hebbianLearningRate: 0.1,
  baseDecayRate: 0.001,
};

// ============================================================================
// AssociativeMemory Class
// ============================================================================

export class AssociativeMemory extends EventEmitter {
  private graph: KnowledgeGraphDB;
  private config: AssociativeMemoryConfig;
  
  // Short-term activation state
  private activations: Map<string, number> = new Map();
  private recentTraces: MemoryTrace[] = [];
  private maxTraces: number = 100;
  
  constructor(graph: KnowledgeGraphDB, config?: Partial<AssociativeMemoryConfig>) {
    super();
    this.graph = graph;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // ==========================================================================
  // Spreading Activation
  // ==========================================================================
  
  /**
   * Activate a concept and spread activation to associated concepts
   * This is the core neural-like memory retrieval mechanism
   */
  async activate(concepts: string[]): Promise<ActivationResult[]> {
    const results: ActivationResult[] = [];
    this.activations.clear();
    
    // Set initial activations
    for (const concept of concepts) {
      this.activations.set(concept.toLowerCase(), 1.0);
      results.push({
        concept: concept.toLowerCase(),
        activation: 1.0,
        source: 'direct',
        depth: 0,
      });
    }
    
    // Spread activation iteratively
    for (let depth = 1; depth <= this.config.maxSpreadDepth; depth++) {
      const newActivations: Map<string, number> = new Map();
      
      for (const [concept, activation] of this.activations) {
        if (activation < this.config.activationThreshold) continue;
        
        // Get associated concepts
        const associations = await this.graph.getAssociationsFor(concept, 20);
        
        for (const { concept: associated, strength } of associations) {
          const spreadActivation = activation * strength * (1 - this.config.spreadingDecay);
          
          if (spreadActivation >= this.config.activationThreshold) {
            const existing = newActivations.get(associated) || 0;
            newActivations.set(associated, Math.max(existing, spreadActivation));
          }
        }
      }
      
      // Add new activations
      for (const [concept, activation] of newActivations) {
        if (!this.activations.has(concept)) {
          this.activations.set(concept, activation);
          results.push({
            concept,
            activation,
            source: 'spread',
            depth,
          });
        }
      }
    }
    
    // Sort by activation strength
    results.sort((a, b) => b.activation - a.activation);
    
    // Record trace
    this.recordTrace(concepts);
    
    this.emit('activation', { concepts, results });
    return results;
  }
  
  /**
   * Get current activation level for a concept
   */
  getActivation(concept: string): number {
    return this.activations.get(concept.toLowerCase()) || 0;
  }
  
  /**
   * Get all currently activated concepts above threshold
   */
  getActiveConcrepts(threshold: number = 0.1): Array<{ concept: string; activation: number }> {
    const active: Array<{ concept: string; activation: number }> = [];
    
    for (const [concept, activation] of this.activations) {
      if (activation >= threshold) {
        active.push({ concept, activation });
      }
    }
    
    return active.sort((a, b) => b.activation - a.activation);
  }
  
  // ==========================================================================
  // Hebbian Learning
  // ==========================================================================
  
  /**
   * Apply Hebbian learning: "neurons that fire together wire together"
   * Strengthens associations between co-activated concepts
   */
  async hebbianLearn(concepts: string[]): Promise<void> {
    if (concepts.length < 2) return;
    
    const normalized = concepts.map(c => c.toLowerCase());
    
    // Strengthen associations between all pairs
    for (let i = 0; i < normalized.length; i++) {
      for (let j = i + 1; j < normalized.length; j++) {
        const conceptA = normalized[i];
        const conceptB = normalized[j];
        
        // Get current association
        const current = await this.graph.getAssociation(conceptA, conceptB);
        const currentStrength = current?.strength || 0;
        
        // Calculate new strength using Hebbian rule
        // Δw = η * a * b (simplified: both are activated so = learning rate)
        const newStrength = Math.min(1.0, currentStrength + this.config.hebbianLearningRate * (1 - currentStrength));
        
        await this.graph.setAssociation(conceptA, conceptB, newStrength);
        
        logger.debug(`Hebbian learning: ${conceptA} <-> ${conceptB}: ${currentStrength.toFixed(3)} -> ${newStrength.toFixed(3)}`);
      }
    }
    
    this.emit('learning', { concepts: normalized, type: 'hebbian' });
  }
  
  /**
   * Weaken association between concepts (anti-Hebbian)
   */
  async weakenAssociation(conceptA: string, conceptB: string, amount: number = 0.1): Promise<void> {
    const current = await this.graph.getAssociation(conceptA.toLowerCase(), conceptB.toLowerCase());
    if (!current) return;
    
    const newStrength = Math.max(0, current.strength - amount);
    await this.graph.setAssociation(conceptA.toLowerCase(), conceptB.toLowerCase(), newStrength);
  }
  
  // ==========================================================================
  // Memory Traces
  // ==========================================================================
  
  /**
   * Record a memory trace (sequence of concepts activated together)
   */
  private recordTrace(concepts: string[]): void {
    const trace: MemoryTrace = {
      concepts: concepts.map(c => c.toLowerCase()),
      timestamp: Date.now(),
      strength: 1.0,
    };
    
    this.recentTraces.unshift(trace);
    
    // Keep only recent traces
    while (this.recentTraces.length > this.maxTraces) {
      this.recentTraces.pop();
    }
  }
  
  /**
   * Get recent memory traces containing a concept
   */
  getRecentTraces(concept?: string, limit: number = 10): MemoryTrace[] {
    let traces = this.recentTraces;
    
    if (concept) {
      const lowerConcept = concept.toLowerCase();
      traces = traces.filter(t => t.concepts.includes(lowerConcept));
    }
    
    return traces.slice(0, limit);
  }
  
  /**
   * Find concepts that frequently co-occur with the given concept
   */
  async findCoOccurring(concept: string, limit: number = 10): Promise<Array<{ concept: string; count: number }>> {
    const lowerConcept = concept.toLowerCase();
    const coOccurrences: Map<string, number> = new Map();
    
    for (const trace of this.recentTraces) {
      if (trace.concepts.includes(lowerConcept)) {
        for (const c of trace.concepts) {
          if (c !== lowerConcept) {
            coOccurrences.set(c, (coOccurrences.get(c) || 0) + 1);
          }
        }
      }
    }
    
    const results = Array.from(coOccurrences.entries())
      .map(([concept, count]) => ({ concept, count }))
      .sort((a, b) => b.count - a.count);
    
    return results.slice(0, limit);
  }
  
  // ==========================================================================
  // Pattern Completion
  // ==========================================================================
  
  /**
   * Given partial concepts, predict/complete the pattern
   * Uses spreading activation to find likely related concepts
   */
  async completePattern(partialConcepts: string[], numPredictions: number = 5): Promise<string[]> {
    // Activate the partial concepts
    const results = await this.activate(partialConcepts);
    
    // Get top spread activations (excluding input concepts)
    const inputSet = new Set(partialConcepts.map(c => c.toLowerCase()));
    
    const predictions = results
      .filter(r => r.source === 'spread' && !inputSet.has(r.concept))
      .slice(0, numPredictions)
      .map(r => r.concept);
    
    return predictions;
  }
  
  /**
   * Find the semantic context around a concept
   */
  async getSemanticContext(concept: string, radius: number = 2): Promise<Map<string, number>> {
    const context = new Map<string, number>();
    const visited = new Set<string>();
    const queue: Array<{ concept: string; depth: number; strength: number }> = [
      { concept: concept.toLowerCase(), depth: 0, strength: 1.0 }
    ];
    
    while (queue.length > 0) {
      const { concept: current, depth, strength } = queue.shift()!;
      
      if (visited.has(current) || depth > radius) continue;
      visited.add(current);
      
      context.set(current, strength);
      
      // Get associations
      const associations = await this.graph.getAssociationsFor(current, 10);
      
      for (const { concept: associated, strength: assocStrength } of associations) {
        if (!visited.has(associated)) {
          queue.push({
            concept: associated,
            depth: depth + 1,
            strength: strength * assocStrength * (1 - this.config.spreadingDecay),
          });
        }
      }
    }
    
    return context;
  }
  
  // ==========================================================================
  // Association Analysis
  // ==========================================================================
  
  /**
   * Calculate semantic similarity between two concepts
   */
  async similarity(conceptA: string, conceptB: string): Promise<number> {
    // Get semantic contexts
    const contextA = await this.getSemanticContext(conceptA.toLowerCase());
    const contextB = await this.getSemanticContext(conceptB.toLowerCase());
    
    // Calculate Jaccard-like similarity
    const allConcepts = new Set([...contextA.keys(), ...contextB.keys()]);
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (const concept of allConcepts) {
      const a = contextA.get(concept) || 0;
      const b = contextB.get(concept) || 0;
      dotProduct += a * b;
      normA += a * a;
      normB += b * b;
    }
    
    if (normA === 0 || normB === 0) return 0;
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  
  /**
   * Find bridging concepts that connect two concepts
   */
  async findBridge(conceptA: string, conceptB: string): Promise<string[]> {
    const contextA = await this.getSemanticContext(conceptA.toLowerCase());
    const contextB = await this.getSemanticContext(conceptB.toLowerCase());
    
    // Find concepts in both contexts
    const bridges: Array<{ concept: string; score: number }> = [];
    
    for (const [concept, strengthA] of contextA) {
      if (concept === conceptA.toLowerCase() || concept === conceptB.toLowerCase()) continue;
      
      const strengthB = contextB.get(concept);
      if (strengthB) {
        bridges.push({
          concept,
          score: Math.min(strengthA, strengthB),
        });
      }
    }
    
    return bridges
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(b => b.concept);
  }
  
  // ==========================================================================
  // Maintenance
  // ==========================================================================
  
  /**
   * Apply decay to associations and clean up weak ones
   */
  async runMaintenance(): Promise<{ decayed: number }> {
    const result = await this.graph.decayAssociations(this.config.baseDecayRate);
    
    // Clear old traces
    const oneDayAgo = Date.now() - 86400000;
    this.recentTraces = this.recentTraces.filter(t => t.timestamp > oneDayAgo);
    
    logger.debug(`Associative memory maintenance: ${result.affected} associations decayed`);
    return { decayed: result.affected };
  }
  
  /**
   * Get statistics about the associative memory
   */
  async getStats(): Promise<{
    activeConceptCount: number;
    traceCount: number;
    strongestAssociations: Array<{ conceptA: string; conceptB: string; strength: number }>;
  }> {
    const strongestAssociations = await this.graph.getStrongestAssociations(10);
    
    return {
      activeConceptCount: this.activations.size,
      traceCount: this.recentTraces.length,
      strongestAssociations,
    };
  }
  
  /**
   * Reset short-term activation state
   */
  resetActivations(): void {
    this.activations.clear();
  }
}

export default AssociativeMemory;
