/**
 * Atlas Desktop - Task Framework Test Script
 * Tests the task queue manager and task executor functionality
 */

import { initializeTaskQueue, getTaskQueueManager } from '../src/main/agent/task-queue';
import { initializeTaskExecutor, getTaskExecutor } from '../src/main/agent/task-framework';
import type { CreateTaskOptions } from '../src/shared/types/task';

// Test counters
let passed = 0;
let failed = 0;
const results: Array<{ name: string; status: 'PASS' | 'FAIL'; error?: string }> = [];

/**
 * Helper to run a test
 */
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    results.push({ name, status: 'PASS' });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    const errorMsg = error instanceof Error ? error.message : String(error);
    results.push({ name, status: 'FAIL', error: errorMsg });
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${errorMsg}`);
  }
}

/**
 * Assert helper
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Wait helper
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Task Queue Manager Tests
 */
async function testTaskQueueManager(): Promise<void> {
  console.log('\n📋 Task Queue Manager Tests\n');

  // Initialize
  const queueManager = initializeTaskQueue({
    maxConcurrent: 2,
    maxQueueSize: 10,
    autoCleanup: false,
  });

  await test('TaskQueueManager should be a singleton', () => {
    const instance1 = getTaskQueueManager();
    const instance2 = getTaskQueueManager();
    assert(instance1 === instance2, 'Should return same instance');
  });

  await test('createTask should create a valid task', () => {
    const options: CreateTaskOptions = {
      name: 'Test Task',
      description: 'A test task',
      priority: 'normal',
      steps: [
        {
          name: 'Step 1',
          type: 'delay',
          config: { type: 'delay', durationMs: 100 },
          errorStrategy: 'fail',
        },
      ],
    };

    const task = queueManager.createTask(options);

    assert(task.id !== undefined, 'Task should have an ID');
    assert(task.name === 'Test Task', 'Task name should match');
    assert(task.status === 'pending', 'Task should be pending');
    assert(task.steps.length === 1, 'Task should have one step');
  });

  await test('enqueue should add task to queue', () => {
    const options: CreateTaskOptions = {
      name: 'Queued Task',
      steps: [
        {
          name: 'Step 1',
          type: 'delay',
          config: { type: 'delay', durationMs: 100 },
          errorStrategy: 'fail',
        },
      ],
    };

    const task = queueManager.createTask(options);
    queueManager.enqueue(task);

    const queued = queueManager.getQueuedTasks();
    assert(
      queued.some((t) => t.id === task.id),
      'Task should be in queue'
    );
  });

  await test('getStats should return queue statistics', () => {
    const stats = queueManager.getStats();

    assert(typeof stats.pending === 'number', 'Should have pending count');
    assert(typeof stats.running === 'number', 'Should have running count');
    assert(typeof stats.completed === 'number', 'Should have completed count');
    assert(typeof stats.failed === 'number', 'Should have failed count');
  });

  await test('priority ordering should work (urgent first)', () => {
    // Clear queue first
    queueManager.clearCompleted();

    const lowTask = queueManager.createTask({
      name: 'Low Priority',
      priority: 'low',
      steps: [
        {
          name: 'Step',
          type: 'delay',
          config: { type: 'delay', durationMs: 100 },
          errorStrategy: 'fail',
        },
      ],
    });

    const urgentTask = queueManager.createTask({
      name: 'Urgent Priority',
      priority: 'urgent',
      steps: [
        {
          name: 'Step',
          type: 'delay',
          config: { type: 'delay', durationMs: 100 },
          errorStrategy: 'fail',
        },
      ],
    });

    queueManager.enqueue(lowTask);
    queueManager.enqueue(urgentTask);

    const queued = queueManager.getQueuedTasks();
    // Urgent should be before low in queue
    const urgentIndex = queued.findIndex((t) => t.id === urgentTask.id);
    const lowIndex = queued.findIndex((t) => t.id === lowTask.id);

    assert(urgentIndex < lowIndex, 'Urgent task should be before low priority task');
  });

  await test('cancelTask should cancel a queued task', () => {
    const task = queueManager.createTask({
      name: 'Task to Cancel',
      steps: [
        {
          name: 'Step',
          type: 'delay',
          config: { type: 'delay', durationMs: 100 },
          errorStrategy: 'fail',
        },
      ],
    });

    queueManager.enqueue(task);
    const cancelled = queueManager.cancelTask(task.id, 'Test cancellation');

    assert(cancelled === true, 'Cancel should return true');

    const queued = queueManager.getQueuedTasks();
    assert(!queued.some((t) => t.id === task.id), 'Task should not be in queue');
  });

  await test('getTask should retrieve task by ID', () => {
    const task = queueManager.createTask({
      name: 'Retrievable Task',
      steps: [
        {
          name: 'Step',
          type: 'delay',
          config: { type: 'delay', durationMs: 100 },
          errorStrategy: 'fail',
        },
      ],
    });

    queueManager.enqueue(task);

    const retrieved = queueManager.getTask(task.id);
    assert(retrieved !== undefined, 'Should find task');
    assert(retrieved?.name === 'Retrievable Task', 'Task name should match');
  });

  // Cleanup
  queueManager.shutdown();
}

/**
 * Task Executor Tests (basic structure tests)
 */
async function testTaskExecutor(): Promise<void> {
  console.log('\n🔧 Task Executor Tests\n');

  // Initialize fresh instances
  const queueManager = initializeTaskQueue({
    maxConcurrent: 2,
    maxQueueSize: 10,
    autoCleanup: false,
  });

  const executor = initializeTaskExecutor();

  await test('TaskExecutor should be a singleton', () => {
    const instance1 = getTaskExecutor();
    const instance2 = getTaskExecutor();
    assert(instance1 === instance2, 'Should return same instance');
  });

  await test('TaskExecutor should have setLLMCallback method', () => {
    assert(typeof executor.setLLMCallback === 'function', 'Should have setLLMCallback');
  });

  await test('TaskExecutor should have setUserInputCallback method', () => {
    assert(typeof executor.setUserInputCallback === 'function', 'Should have setUserInputCallback');
  });

  await test('TaskExecutor should have cancelTask method', () => {
    assert(typeof executor.cancelTask === 'function', 'Should have cancelTask');
  });

  await test('TaskExecutor should listen for task:started events', async () => {
    let taskStarted = false;

    // Set up LLM callback for any LLM steps
    executor.setLLMCallback(async (prompt: string) => {
      return `Response to: ${prompt}`;
    });

    queueManager.on('task:started', () => {
      taskStarted = true;
    });

    // Create a simple delay task
    const task = queueManager.createTask({
      name: 'Event Test Task',
      steps: [
        {
          name: 'Delay Step',
          type: 'delay',
          config: { type: 'delay', durationMs: 50 },
          errorStrategy: 'fail',
        },
      ],
    });

    queueManager.enqueue(task);

    // Process queue
    queueManager.processQueue();

    // Wait for task to start
    await wait(100);

    assert(taskStarted, 'task:started event should fire');
  });

  await test('delay step should execute correctly', async () => {
    let completed = false;

    const completionHandler = (event: { taskId: string; status: string }) => {
      if (event.status === 'completed') {
        completed = true;
      }
    };

    queueManager.on('task:completed', completionHandler);

    const task = queueManager.createTask({
      name: 'Delay Execution Test',
      steps: [
        {
          name: 'Short Delay',
          type: 'delay',
          config: { type: 'delay', durationMs: 50 },
          errorStrategy: 'fail',
        },
      ],
    });

    queueManager.enqueue(task);
    queueManager.processQueue();

    // Wait for completion
    await wait(500);

    queueManager.off('task:completed', completionHandler);

    assert(completed, 'Task should complete');
  });

  // Cleanup
  executor.shutdown();
  queueManager.shutdown();
}

/**
 * Integration Tests
 */
async function testIntegration(): Promise<void> {
  console.log('\n🔄 Integration Tests\n');

  const queueManager = initializeTaskQueue({
    maxConcurrent: 2,
    maxQueueSize: 10,
    autoCleanup: false,
  });

  const executor = initializeTaskExecutor();

  // Set up mock LLM callback
  executor.setLLMCallback(async (prompt: string) => {
    return `Mock LLM response for: ${prompt.substring(0, 50)}...`;
  });

  await test('multi-step task should execute all steps', async () => {
    const stepResults: string[] = [];

    queueManager.on('task:step-completed', (event: { taskId: string; step: { name: string } }) => {
      stepResults.push(event.step.name);
    });

    const task = queueManager.createTask({
      name: 'Multi-Step Task',
      steps: [
        {
          name: 'Step 1',
          type: 'delay',
          config: { type: 'delay', durationMs: 30 },
          errorStrategy: 'fail',
        },
        {
          name: 'Step 2',
          type: 'delay',
          config: { type: 'delay', durationMs: 30 },
          errorStrategy: 'fail',
        },
        {
          name: 'Step 3',
          type: 'delay',
          config: { type: 'delay', durationMs: 30 },
          errorStrategy: 'fail',
        },
      ],
    });

    queueManager.enqueue(task);
    queueManager.processQueue();

    // Wait for all steps
    await wait(500);

    assert(stepResults.includes('Step 1'), 'Step 1 should complete');
    assert(stepResults.includes('Step 2'), 'Step 2 should complete');
    assert(stepResults.includes('Step 3'), 'Step 3 should complete');
  });

  await test('progress events should be emitted', async () => {
    const progressEvents: number[] = [];

    const progressHandler = (event: { progress: number }) => {
      progressEvents.push(event.progress);
    };

    queueManager.on('task:progress', progressHandler);

    const task = queueManager.createTask({
      name: 'Progress Test Task',
      steps: [
        {
          name: 'Step 1',
          type: 'delay',
          config: { type: 'delay', durationMs: 30 },
          errorStrategy: 'fail',
        },
        {
          name: 'Step 2',
          type: 'delay',
          config: { type: 'delay', durationMs: 30 },
          errorStrategy: 'fail',
        },
      ],
    });

    queueManager.enqueue(task);
    queueManager.processQueue();

    await wait(500);

    queueManager.off('task:progress', progressHandler);

    assert(progressEvents.length > 0, 'Should receive progress events');
  });

  // Cleanup
  executor.shutdown();
  queueManager.shutdown();
}

/**
 * Main test runner
 */
async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          Atlas Task Framework Test Suite                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  try {
    await testTaskQueueManager();
    await testTaskExecutor();
    await testIntegration();
  } catch (error) {
    console.error('\n❌ Test suite crashed:', error);
  }

  // Summary
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    console.log('Failed tests:');
    results
      .filter((r) => r.status === 'FAIL')
      .forEach((r) => {
        console.log(`  ✗ ${r.name}`);
        if (r.error) console.log(`    ${r.error}`);
      });
  }

  console.log('\n════════════════════════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

main();
