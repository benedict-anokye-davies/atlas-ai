/**
 * @fileoverview WorldBox Integration Module
 * @module vm-agent/worldbox
 * 
 * @description
 * WorldBox-specific functionality for Atlas VM Agent.
 * Enables Atlas to observe, learn from, and interact with WorldBox simulations
 * to understand evolutionary principles.
 */

import {
  EvolutionaryObserver,
  getEvolutionaryObserver,
  shutdownEvolutionaryObserver,
} from './evolutionary-observer';
import type {
  TrackedCivilization,
  SimulationEvent,
  EvolutionaryInsight,
  WorldSnapshot,
  ObservationSession,
} from './evolutionary-observer';
import {
  processWorldBoxCommand,
  worldBoxVoiceCommand,
} from './voice-commands';
import type { CommandResult } from './voice-commands';

export {
  EvolutionaryObserver,
  getEvolutionaryObserver,
  shutdownEvolutionaryObserver,
  processWorldBoxCommand,
  worldBoxVoiceCommand,
};
export type {
  TrackedCivilization,
  SimulationEvent,
  EvolutionaryInsight,
  WorldSnapshot,
  ObservationSession,
  CommandResult,
};
