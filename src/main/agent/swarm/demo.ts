/**
 * @fileoverview Atlas Swarm Demo - Example usage of swarm for Atlas development
 * @module agent/swarm/demo
 * @author Atlas Team
 * @since 2.0.0
 *
 * @description
 * Demonstrates how to use the agent swarm to work on the Atlas codebase itself.
 * This is a self-improving system where Atlas can improve its own code.
 *
 * Run this demo:
 * ```bash
 * npx ts-node src/main/agent/swarm/demo.ts
 * ```
 */

import {
  initializeAtlasSwarm,
  runAtlasImprovement,
  quickAtlasFix,
  getAtlasSwarmStatus,
} from './index';

// =============================================================================
// Demo Functions
// =============================================================================

/**
 * Demo 1: Fix TypeScript errors
 */
async function demoFixTypeScriptErrors() {
  console.log('\n🚀 Demo 1: Fixing TypeScript Errors\n');

  const result = await quickAtlasFix(
    'Fix TypeScript compilation errors in src/main/agent/tools/index.ts'
  );

  console.log(result);
}

/**
 * Demo 2: Add a new feature
 */
async function demoAddFeature() {
  console.log('\n🚀 Demo 2: Adding a New Feature\n');

  const result = await runAtlasImprovement(
    'Add comprehensive JSDoc documentation to all public methods in the swarm system',
    'medium'
  );

  console.log('Feature addition result:');
  console.log(`Success: ${result.success}`);
  console.log(`Duration: ${result.metadata.duration}ms`);
  console.log(`Agents used: ${result.metadata.agentCount}`);
  console.log(`Subtasks: ${result.metadata.taskCount}`);
}

/**
 * Demo 3: Refactor code
 */
async function demoRefactor() {
  console.log('\n🚀 Demo 3: Code Refactoring\n');

  const result = await runAtlasImprovement(
    'Refactor the agent tools index.ts to fix type mismatches and export issues',
    'high'
  );

  console.log('Refactoring result:');
  console.log(`Success: ${result.success}`);
  console.log(`Files modified: ${result.results.length}`);
}

/**
 * Demo 4: Check swarm status
 */
function demoCheckStatus() {
  console.log('\n🚀 Demo 4: Checking Swarm Status\n');

  const status = getAtlasSwarmStatus();

  console.log('Atlas Development Swarm Status:');
  console.log(`  Initialized: ${status.initialized}`);
  console.log(`  Total Agents: ${status.agentCount}`);
  console.log(`  Active Agents: ${status.activeAgents}`);
  console.log(`  Tasks Completed: ${status.metrics.totalTasks}`);
  console.log(
    `  Success Rate: ${((status.metrics.successfulTasks / Math.max(1, status.metrics.totalTasks)) * 100).toFixed(1)}%`
  );
}

/**
 * Demo 5: Complex multi-step improvement
 */
async function demoComplexImprovement() {
  console.log('\n🚀 Demo 5: Complex Multi-Agent Improvement\n');

  // Initialize swarm
  const swarm = await initializeAtlasSwarm();

  console.log('Swarm initialized with agents:');
  swarm.getAllAgents().forEach((agent) => {
    console.log(`  - ${agent.name} (${agent.type})`);
  });

  // Execute complex task
  const result = await swarm.executeTask({
    id: 'complex-atlas-improvement',
    description:
      'Analyze the Atlas codebase, identify the most critical TypeScript errors, and fix them. Also add tests for any new code written.',
    complexity: 'critical',
    type: 'atlas-development',
  });

  console.log('\nComplex task completed:');
  console.log(`Success: ${result.success}`);
  console.log(`Execution mode: ${result.metadata.executionMode}`);
  console.log(`Consensus score: ${result.consensusScore || 'N/A'}`);

  if (result.results.length > 0) {
    console.log('\nIndividual agent results:');
    result.results.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.success ? '✅' : '❌'} ${r.output?.substring(0, 100)}...`);
    });
  }
}

// =============================================================================
// Main Demo Runner
// =============================================================================

/**
 * Run all demos
 */
async function runAllDemos() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     🤖 Atlas Self-Improving Agent Swarm Demo 🤖           ║');
  console.log('║                                                            ║');
  console.log('║  This demo shows how Atlas can improve its own codebase   ║');
  console.log('║  using multiple specialized AI agents working together    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  try {
    // Run demos
    await demoCheckStatus();
    // await demoFixTypeScriptErrors(); // Uncomment to actually run
    // await demoAddFeature(); // Uncomment to actually run
    // await demoRefactor(); // Uncomment to actually run
    // await demoComplexImprovement(); // Uncomment to actually run

    console.log('\n✨ Demo completed!\n');
    console.log('To actually run the swarm on Atlas:');
    console.log('  1. Uncomment the demo function calls above');
    console.log('  2. Run: npx ts-node src/main/agent/swarm/demo.ts');
    console.log('\nOr use the Atlas CLI/Interface to trigger improvements.');
  } catch (error) {
    console.error('\n❌ Demo failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runAllDemos();
}

// Export for use in other modules
export {
  demoFixTypeScriptErrors,
  demoAddFeature,
  demoRefactor,
  demoCheckStatus,
  demoComplexImprovement,
  runAllDemos,
};
