/**
 * @fileoverview Agent Swarm Module - Multi-agent orchestration exports
 * @module agent/swarm
 * @author Atlas Team
 * @since 2.0.0
 *
 * @description
 * Central exports for the agent swarm system. Provides multi-agent
 * orchestration capabilities for complex task execution.
 */

// Core swarm components
export {
  AgentSwarmController,
  getSwarmController,
  initializeSwarm,
  shutdownSwarm,
  DEFAULT_SWARM_CONFIG,
} from './controller';

export type { SwarmConfig, SwarmResult } from './controller';

// Base agent
export { BaseAgent } from './base-agent';

// Types
export * from './types';

// Specialized agents
export {
  CoderAgent,
  ResearchAgent,
  SystemAgent,
  CreativeAgent,
  DataAgent,
  createAgent,
} from './specialized-agents';

// Atlas self-improvement agent
export { AtlasDeveloperAgent } from './atlas-developer-agent';

// Atlas swarm setup and execution
export {
  initializeAtlasSwarm,
  runAtlasImprovement,
  runMultipleAtlasImprovements,
  quickAtlasFix,
  getAtlasSwarmStatus,
} from './atlas-swarm-setup';

// Supporting components
export { TaskDecomposer } from './task-decomposer';
export { AgentCommunicator } from './communicator';
export { ResultAggregator } from './result-aggregator';
