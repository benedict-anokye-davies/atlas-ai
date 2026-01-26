/**
 * Atlas Desktop - VM Agent Multi-VM Orchestration
 *
 * Manages multiple virtual machines simultaneously, enabling complex
 * workflows that span different VMs and operating systems.
 *
 * @module vm-agent/workflows/multi-vm
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../../utils/logger';
import { getEventBus, createEvent } from '../core/event-bus';
import { getCheckpointManager } from '../core/checkpoint-manager';
import { VMConnectionConfig, VMAction, ScreenState } from '../types';
import { VMConnector } from '../vm-connector';

const logger = createModuleLogger('MultiVMOrchestration');

// =============================================================================
// Multi-VM Constants
// =============================================================================

export const MULTI_VM_CONSTANTS = {
  /** Maximum concurrent VMs */
  MAX_CONCURRENT_VMS: 5,
  /** VM health check interval */
  HEALTH_CHECK_INTERVAL_MS: 30000,
  /** VM connection timeout */
  CONNECTION_TIMEOUT_MS: 30000,
  /** Screenshot interval for monitoring */
  SCREENSHOT_INTERVAL_MS: 5000,
  /** Storage file */
  STORAGE_FILE: 'vm-multi-vm-config.json',
} as const;

// =============================================================================
// Multi-VM Types
// =============================================================================

export type VMStatus = 'disconnected' | 'connecting' | 'connected' | 'busy' | 'error' | 'paused';

export interface ManagedVM {
  /** VM ID */
  id: string;
  /** Display name */
  name: string;
  /** Connection config */
  connectionConfig: VMConnectionConfig;
  /** Current status */
  status: VMStatus;
  /** Last screenshot */
  lastScreenshot?: Buffer;
  /** Last screen state */
  lastScreenState?: ScreenState;
  /** Last activity */
  lastActivity: number;
  /** Error message */
  lastError?: string;
  /** Tags for organization */
  tags: string[];
  /** Connector instance */
  connector?: VMConnector;
  /** Health stats */
  healthStats: VMHealthStats;
}

export interface VMHealthStats {
  /** Connection uptime */
  uptimeMs: number;
  /** Connected at */
  connectedAt?: number;
  /** Total actions executed */
  actionsExecuted: number;
  /** Actions succeeded */
  actionsSucceeded: number;
  /** Actions failed */
  actionsFailed: number;
  /** Reconnection count */
  reconnectionCount: number;
  /** Average response time */
  avgResponseTimeMs: number;
}

export interface MultiVMTask {
  /** Task ID */
  id: string;
  /** Task name */
  name: string;
  /** Description */
  description: string;
  /** VM assignments */
  vmAssignments: VMTaskAssignment[];
  /** Synchronization points */
  syncPoints: SyncPoint[];
  /** Status */
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  /** Started at */
  startedAt?: number;
  /** Completed at */
  completedAt?: number;
  /** Results per VM */
  results: Record<string, VMTaskResult>;
}

export interface VMTaskAssignment {
  /** VM ID */
  vmId: string;
  /** Actions to execute */
  actions: VMAction[];
  /** Current action index */
  currentActionIndex: number;
  /** Status */
  status: 'pending' | 'running' | 'waiting' | 'completed' | 'failed';
  /** Wait at sync point */
  waitAtSyncPoint?: string;
}

export interface SyncPoint {
  /** Sync point ID */
  id: string;
  /** Name */
  name: string;
  /** VMs that must reach this point */
  requiredVMs: string[];
  /** VMs that have reached */
  reachedVMs: string[];
  /** Data to exchange */
  exchangeData?: Record<string, unknown>;
  /** Timeout */
  timeout: number;
}

export interface VMTaskResult {
  /** VM ID */
  vmId: string;
  /** Success */
  success: boolean;
  /** Actions completed */
  actionsCompleted: number;
  /** Errors */
  errors: string[];
  /** Extracted data */
  extractedData?: Record<string, unknown>;
  /** Duration */
  durationMs: number;
}

export interface VMCluster {
  /** Cluster ID */
  id: string;
  /** Cluster name */
  name: string;
  /** Description */
  description: string;
  /** VM IDs */
  vmIds: string[];
  /** Created at */
  createdAt: number;
}

export interface DataTransfer {
  /** Transfer ID */
  id: string;
  /** Source VM */
  sourceVmId: string;
  /** Target VM */
  targetVmId: string;
  /** Data type */
  dataType: 'text' | 'file' | 'clipboard' | 'screenshot';
  /** Data content */
  data: string | Buffer;
  /** Status */
  status: 'pending' | 'transferring' | 'completed' | 'failed';
  /** Progress */
  progress: number;
  /** Created at */
  createdAt: number;
}

// =============================================================================
// Multi-VM Manager
// =============================================================================

/**
 * Manages multiple VMs simultaneously
 *
 * @example
 * ```typescript
 * const manager = getMultiVMManager();
 *
 * // Add VMs
 * await manager.addVM({ name: 'Windows Server', connectionConfig: { ... } });
 * await manager.addVM({ name: 'Linux Dev', connectionConfig: { ... } });
 *
 * // Create a task that runs on multiple VMs
 * const task = await manager.createTask({
 *   name: 'Deploy Update',
 *   vmAssignments: [
 *     { vmId: 'vm1', actions: [...] },
 *     { vmId: 'vm2', actions: [...] }
 *   ],
 *   syncPoints: [
 *     { id: 'sync1', requiredVMs: ['vm1', 'vm2'], ... }
 *   ]
 * });
 *
 * await manager.executeTask(task.id);
 * ```
 */
export class MultiVMManager extends EventEmitter {
  private vms: Map<string, ManagedVM> = new Map();
  private tasks: Map<string, MultiVMTask> = new Map();
  private clusters: Map<string, VMCluster> = new Map();
  private transfers: Map<string, DataTransfer> = new Map();
  private dataDir: string;
  private initialized: boolean = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    super();
    this.dataDir = path.join(app.getPath('userData'), 'vm-agent');
  }

  /**
   * Initialize the manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      await this.loadFromDisk();

      // Start health monitoring
      this.startHealthMonitoring();

      this.initialized = true;
      logger.info('Multi-VM manager initialized', {
        vms: this.vms.size,
        clusters: this.clusters.size,
      });
    } catch (error) {
      logger.error('Failed to initialize multi-VM manager', { error });
      this.initialized = true;
    }
  }

  // ==========================================================================
  // VM Management
  // ==========================================================================

  /**
   * Add a VM to management
   */
  async addVM(config: {
    name: string;
    connectionConfig: VMConnectionConfig;
    tags?: string[];
  }): Promise<ManagedVM> {
    await this.ensureInitialized();

    if (this.vms.size >= MULTI_VM_CONSTANTS.MAX_CONCURRENT_VMS) {
      throw new Error(`Maximum VM limit reached (${MULTI_VM_CONSTANTS.MAX_CONCURRENT_VMS})`);
    }

    const vm: ManagedVM = {
      id: `vm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: config.name,
      connectionConfig: config.connectionConfig,
      status: 'disconnected',
      lastActivity: Date.now(),
      tags: config.tags || [],
      healthStats: {
        uptimeMs: 0,
        actionsExecuted: 0,
        actionsSucceeded: 0,
        actionsFailed: 0,
        reconnectionCount: 0,
        avgResponseTimeMs: 0,
      },
    };

    this.vms.set(vm.id, vm);
    this.scheduleSave();

    const eventBus = getEventBus();
    eventBus.emitSync(
      createEvent(
        'vm:added',
        { vmId: vm.id, name: vm.name },
        'multi-vm',
        { priority: 'normal' },
      ),
    );

    this.emit('vm-added', vm);
    logger.info('VM added', { vmId: vm.id, name: vm.name });

    return vm;
  }

  /**
   * Remove a VM
   */
  async removeVM(vmId: string): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm) return;

    // Disconnect if connected
    if (vm.connector) {
      await vm.connector.disconnect();
    }

    // Stop monitoring
    const monitorInterval = this.monitoringIntervals.get(vmId);
    if (monitorInterval) {
      clearInterval(monitorInterval);
      this.monitoringIntervals.delete(vmId);
    }

    this.vms.delete(vmId);
    this.scheduleSave();

    // Remove from clusters
    for (const cluster of this.clusters.values()) {
      cluster.vmIds = cluster.vmIds.filter((id) => id !== vmId);
    }

    this.emit('vm-removed', vmId);
    logger.info('VM removed', { vmId });
  }

  /**
   * Connect to a VM
   */
  async connectVM(vmId: string): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm) throw new Error(`VM not found: ${vmId}`);

    if (vm.status === 'connected') return;

    vm.status = 'connecting';
    this.emit('vm-status-changed', { vmId, status: 'connecting' });

    try {
      vm.connector = new VMConnector();
      await vm.connector.connect(vm.connectionConfig);

      vm.status = 'connected';
      vm.healthStats.connectedAt = Date.now();
      vm.lastActivity = Date.now();
      vm.lastError = undefined;

      // Start monitoring
      this.startVMMonitoring(vmId);

      this.emit('vm-connected', vm);
      logger.info('VM connected', { vmId, name: vm.name });
    } catch (error) {
      vm.status = 'error';
      vm.lastError = error instanceof Error ? error.message : 'Connection failed';
      vm.healthStats.reconnectionCount++;

      this.emit('vm-error', { vmId, error: vm.lastError });
      logger.error('VM connection failed', { vmId, error: vm.lastError });

      throw error;
    }
  }

  /**
   * Disconnect from a VM
   */
  async disconnectVM(vmId: string): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm || !vm.connector) return;

    try {
      await vm.connector.disconnect();
    } catch (error) {
      logger.warn('VM disconnect error', { vmId, error });
    }

    vm.connector = undefined;
    vm.status = 'disconnected';

    if (vm.healthStats.connectedAt) {
      vm.healthStats.uptimeMs += Date.now() - vm.healthStats.connectedAt;
      vm.healthStats.connectedAt = undefined;
    }

    // Stop monitoring
    const monitorInterval = this.monitoringIntervals.get(vmId);
    if (monitorInterval) {
      clearInterval(monitorInterval);
      this.monitoringIntervals.delete(vmId);
    }

    this.emit('vm-disconnected', vmId);
    logger.info('VM disconnected', { vmId });
  }

  /**
   * Get VM status
   */
  getVM(vmId: string): ManagedVM | undefined {
    return this.vms.get(vmId);
  }

  /**
   * List all VMs
   */
  listVMs(): ManagedVM[] {
    return Array.from(this.vms.values());
  }

  /**
   * Execute action on VM
   */
  async executeOnVM(vmId: string, action: VMAction): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm) throw new Error(`VM not found: ${vmId}`);
    if (!vm.connector) throw new Error(`VM not connected: ${vmId}`);

    const startTime = Date.now();
    vm.status = 'busy';
    vm.lastActivity = Date.now();
    vm.healthStats.actionsExecuted++;

    try {
      await vm.connector.executeAction(action);
      vm.healthStats.actionsSucceeded++;

      const duration = Date.now() - startTime;
      vm.healthStats.avgResponseTimeMs =
        (vm.healthStats.avgResponseTimeMs * (vm.healthStats.actionsExecuted - 1) + duration) /
        vm.healthStats.actionsExecuted;
    } catch (error) {
      vm.healthStats.actionsFailed++;
      throw error;
    } finally {
      vm.status = 'connected';
    }
  }

  /**
   * Get screenshot from VM
   */
  async screenshotVM(vmId: string): Promise<Buffer> {
    const vm = this.vms.get(vmId);
    if (!vm) throw new Error(`VM not found: ${vmId}`);
    if (!vm.connector) throw new Error(`VM not connected: ${vmId}`);

    const screenshot = await vm.connector.screenshot();
    vm.lastScreenshot = screenshot;
    vm.lastActivity = Date.now();

    return screenshot;
  }

  // ==========================================================================
  // Cluster Management
  // ==========================================================================

  /**
   * Create a VM cluster
   */
  createCluster(name: string, vmIds: string[], description?: string): VMCluster {
    const cluster: VMCluster = {
      id: `cluster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      description: description || '',
      vmIds: vmIds.filter((id) => this.vms.has(id)),
      createdAt: Date.now(),
    };

    this.clusters.set(cluster.id, cluster);
    this.scheduleSave();

    logger.info('Cluster created', { clusterId: cluster.id, vmCount: cluster.vmIds.length });

    return cluster;
  }

  /**
   * Get cluster
   */
  getCluster(clusterId: string): VMCluster | undefined {
    return this.clusters.get(clusterId);
  }

  /**
   * List clusters
   */
  listClusters(): VMCluster[] {
    return Array.from(this.clusters.values());
  }

  /**
   * Delete cluster
   */
  deleteCluster(clusterId: string): void {
    this.clusters.delete(clusterId);
    this.scheduleSave();
  }

  /**
   * Connect all VMs in cluster
   */
  async connectCluster(clusterId: string): Promise<void> {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) throw new Error(`Cluster not found: ${clusterId}`);

    const results = await Promise.allSettled(
      cluster.vmIds.map((vmId) => this.connectVM(vmId)),
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      logger.warn('Some VMs failed to connect', { failed: failed.length });
    }
  }

  /**
   * Disconnect all VMs in cluster
   */
  async disconnectCluster(clusterId: string): Promise<void> {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) return;

    await Promise.allSettled(cluster.vmIds.map((vmId) => this.disconnectVM(vmId)));
  }

  // ==========================================================================
  // Multi-VM Task Execution
  // ==========================================================================

  /**
   * Create a multi-VM task
   */
  createTask(config: {
    name: string;
    description?: string;
    vmAssignments: Omit<VMTaskAssignment, 'currentActionIndex' | 'status'>[];
    syncPoints?: Omit<SyncPoint, 'reachedVMs'>[];
  }): MultiVMTask {
    const task: MultiVMTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: config.name,
      description: config.description || '',
      vmAssignments: config.vmAssignments.map((a) => ({
        ...a,
        currentActionIndex: 0,
        status: 'pending' as const,
      })),
      syncPoints: (config.syncPoints || []).map((sp) => ({
        ...sp,
        reachedVMs: [],
      })),
      status: 'pending',
      results: {},
    };

    this.tasks.set(task.id, task);

    logger.info('Multi-VM task created', {
      taskId: task.id,
      vmCount: task.vmAssignments.length,
    });

    return task;
  }

  /**
   * Execute a multi-VM task
   */
  async executeTask(taskId: string): Promise<MultiVMTask> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    task.status = 'running';
    task.startedAt = Date.now();

    const eventBus = getEventBus();
    eventBus.emitSync(
      createEvent(
        'multivm:task-started',
        { taskId, vmCount: task.vmAssignments.length },
        'multi-vm',
        { priority: 'normal' },
      ),
    );

    // Create checkpoint
    await getCheckpointManager().createCheckpoint(
      'auto',
      `Multi-VM task started: ${task.name}`,
      { task },
    );

    try {
      // Execute actions on all VMs in parallel
      const execPromises = task.vmAssignments.map((assignment) =>
        this.executeVMAssignment(task, assignment),
      );

      await Promise.all(execPromises);

      // Check if all succeeded
      const allSucceeded = task.vmAssignments.every((a) => a.status === 'completed');
      task.status = allSucceeded ? 'completed' : 'failed';
    } catch (error) {
      task.status = 'failed';
      logger.error('Multi-VM task failed', { taskId, error });
    }

    task.completedAt = Date.now();

    eventBus.emitSync(
      createEvent(
        'multivm:task-completed',
        { taskId, status: task.status },
        'multi-vm',
        { priority: 'normal' },
      ),
    );

    this.emit('task-completed', task);

    return task;
  }

  /**
   * Pause a running task
   */
  pauseTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return;

    task.status = 'paused';
    this.emit('task-paused', taskId);
  }

  /**
   * Resume a paused task
   */
  async resumeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'paused') return;

    task.status = 'running';
    this.emit('task-resumed', taskId);

    // Continue execution
    const pendingAssignments = task.vmAssignments.filter(
      (a) => a.status === 'waiting' || a.status === 'pending',
    );

    await Promise.all(
      pendingAssignments.map((assignment) => this.executeVMAssignment(task, assignment)),
    );
  }

  /**
   * Get task status
   */
  getTask(taskId: string): MultiVMTask | undefined {
    return this.tasks.get(taskId);
  }

  // ==========================================================================
  // Data Transfer Between VMs
  // ==========================================================================

  /**
   * Transfer data between VMs
   */
  async transferData(
    sourceVmId: string,
    targetVmId: string,
    dataType: 'text' | 'clipboard' | 'screenshot',
    data?: string | Buffer,
  ): Promise<DataTransfer> {
    const sourceVM = this.vms.get(sourceVmId);
    const targetVM = this.vms.get(targetVmId);

    if (!sourceVM) throw new Error(`Source VM not found: ${sourceVmId}`);
    if (!targetVM) throw new Error(`Target VM not found: ${targetVmId}`);

    const transfer: DataTransfer = {
      id: `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sourceVmId,
      targetVmId,
      dataType,
      data: data || Buffer.from(''),
      status: 'pending',
      progress: 0,
      createdAt: Date.now(),
    };

    this.transfers.set(transfer.id, transfer);

    // Execute transfer asynchronously
    this.executeTransfer(transfer).catch((error) => {
      transfer.status = 'failed';
      logger.error('Data transfer failed', { transferId: transfer.id, error });
    });

    return transfer;
  }

  private async executeTransfer(transfer: DataTransfer): Promise<void> {
    transfer.status = 'transferring';
    transfer.progress = 10;

    const sourceVM = this.vms.get(transfer.sourceVmId)!;
    const targetVM = this.vms.get(transfer.targetVmId)!;

    try {
      let dataToTransfer: string | Buffer = transfer.data;

      // Extract from source if needed
      if (transfer.dataType === 'clipboard' && sourceVM.connector) {
        // Get clipboard content from source VM
        await sourceVM.connector.executeAction({ type: 'hotkey', keys: ['Ctrl', 'c'] });
        transfer.progress = 30;
      } else if (transfer.dataType === 'screenshot' && sourceVM.connector) {
        dataToTransfer = await sourceVM.connector.screenshot();
        transfer.progress = 40;
      }

      transfer.progress = 50;

      // Apply to target
      if (targetVM.connector) {
        if (transfer.dataType === 'text' || transfer.dataType === 'clipboard') {
          // Type or paste text
          await targetVM.connector.executeAction({
            type: 'type',
            text: dataToTransfer.toString(),
          });
        }
        // Screenshots and files would need more complex handling
      }

      transfer.progress = 100;
      transfer.status = 'completed';

      logger.info('Data transfer completed', {
        transferId: transfer.id,
        dataType: transfer.dataType,
      });
    } catch (error) {
      transfer.status = 'failed';
      throw error;
    }
  }

  /**
   * Get transfer status
   */
  getTransfer(transferId: string): DataTransfer | undefined {
    return this.transfers.get(transferId);
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async executeVMAssignment(
    task: MultiVMTask,
    assignment: VMTaskAssignment,
  ): Promise<void> {
    const vm = this.vms.get(assignment.vmId);
    if (!vm || !vm.connector) {
      assignment.status = 'failed';
      task.results[assignment.vmId] = {
        vmId: assignment.vmId,
        success: false,
        actionsCompleted: 0,
        errors: ['VM not connected'],
        durationMs: 0,
      };
      return;
    }

    assignment.status = 'running';
    const startTime = Date.now();
    const errors: string[] = [];

    try {
      for (let i = assignment.currentActionIndex; i < assignment.actions.length; i++) {
        // Check for pause
        if (task.status === 'paused') {
          assignment.status = 'waiting';
          return;
        }

        const action = assignment.actions[i];
        assignment.currentActionIndex = i;

        // Check for sync point
        const syncPoint = task.syncPoints.find(
          (sp) =>
            sp.requiredVMs.includes(assignment.vmId) &&
            !sp.reachedVMs.includes(assignment.vmId),
        );

        if (syncPoint && assignment.waitAtSyncPoint === syncPoint.id) {
          await this.waitForSyncPoint(task, syncPoint, assignment.vmId);
        }

        try {
          await this.executeOnVM(assignment.vmId, action);
        } catch (error) {
          errors.push(`Action ${i}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      assignment.status = 'completed';
    } catch (error) {
      assignment.status = 'failed';
      errors.push(error instanceof Error ? error.message : 'Unknown error');
    }

    task.results[assignment.vmId] = {
      vmId: assignment.vmId,
      success: assignment.status === 'completed',
      actionsCompleted: assignment.currentActionIndex + 1,
      errors,
      durationMs: Date.now() - startTime,
    };
  }

  private async waitForSyncPoint(
    task: MultiVMTask,
    syncPoint: SyncPoint,
    vmId: string,
  ): Promise<void> {
    syncPoint.reachedVMs.push(vmId);

    const startTime = Date.now();

    while (!syncPoint.requiredVMs.every((id) => syncPoint.reachedVMs.includes(id))) {
      if (Date.now() - startTime > syncPoint.timeout) {
        throw new Error(`Sync point timeout: ${syncPoint.id}`);
      }

      if (task.status === 'paused') {
        return;
      }

      await this.sleep(500);
    }

    logger.debug('Sync point reached', { syncPointId: syncPoint.id, vmId });
  }

  private startHealthMonitoring(): void {
    if (this.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks().catch((error) => {
        logger.error('Health check error', { error });
      });
    }, MULTI_VM_CONSTANTS.HEALTH_CHECK_INTERVAL_MS);
  }

  private async performHealthChecks(): Promise<void> {
    for (const vm of this.vms.values()) {
      if (vm.status === 'connected' && vm.connector) {
        try {
          // Try to get a screenshot as health check
          await vm.connector.screenshot();
          vm.lastActivity = Date.now();
        } catch (error) {
          logger.warn('VM health check failed', { vmId: vm.id, error });
          vm.status = 'error';
          vm.lastError = error instanceof Error ? error.message : 'Health check failed';

          this.emit('vm-health-check-failed', { vmId: vm.id, error: vm.lastError });
        }
      }
    }
  }

  private startVMMonitoring(vmId: string): void {
    // Don't duplicate monitoring
    if (this.monitoringIntervals.has(vmId)) return;

    const interval = setInterval(async () => {
      const vm = this.vms.get(vmId);
      if (!vm || vm.status !== 'connected' || !vm.connector) {
        clearInterval(interval);
        this.monitoringIntervals.delete(vmId);
        return;
      }

      try {
        const screenshot = await vm.connector.screenshot();
        vm.lastScreenshot = screenshot;
        this.emit('vm-screenshot', { vmId, screenshot });
      } catch (error) {
        // Silent fail for monitoring
      }
    }, MULTI_VM_CONSTANTS.SCREENSHOT_INTERVAL_MS);

    this.monitoringIntervals.set(vmId, interval);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private saveTimeout: NodeJS.Timeout | null = null;
  private scheduleSave(): void {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveToDisk().catch((e) => logger.error('Failed to save multi-VM config', { error: e }));
      this.saveTimeout = null;
    }, 5000);
  }

  private async saveToDisk(): Promise<void> {
    const filePath = path.join(this.dataDir, MULTI_VM_CONSTANTS.STORAGE_FILE);

    // Don't save connector instances or screenshots
    const vmData = Array.from(this.vms.entries()).map(([id, vm]) => [
      id,
      {
        ...vm,
        connector: undefined,
        lastScreenshot: undefined,
        lastScreenState: undefined,
        status: 'disconnected',
      },
    ]);

    const data = {
      vms: vmData,
      clusters: Array.from(this.clusters.entries()),
    };

    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
    logger.debug('Multi-VM config saved', {
      vms: this.vms.size,
      clusters: this.clusters.size,
    });
  }

  private async loadFromDisk(): Promise<void> {
    const filePath = path.join(this.dataDir, MULTI_VM_CONSTANTS.STORAGE_FILE);

    if (!fs.existsSync(filePath)) return;

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      this.vms = new Map(data.vms || []);
      this.clusters = new Map(data.clusters || []);

      // Reset runtime properties
      for (const vm of this.vms.values()) {
        vm.status = 'disconnected';
        vm.connector = undefined;
        vm.lastScreenshot = undefined;
        vm.lastScreenState = undefined;
      }
    } catch (error) {
      logger.warn('Failed to load multi-VM config', { error });
    }
  }

  /**
   * Shutdown manager
   */
  async shutdown(): Promise<void> {
    // Stop health monitoring
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Stop all monitoring intervals
    for (const interval of this.monitoringIntervals.values()) {
      clearInterval(interval);
    }
    this.monitoringIntervals.clear();

    // Disconnect all VMs
    for (const vmId of this.vms.keys()) {
      await this.disconnectVM(vmId);
    }

    // Final save
    await this.saveToDisk();

    logger.info('Multi-VM manager shutdown');
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let multiVMInstance: MultiVMManager | null = null;

/**
 * Get the singleton multi-VM manager
 */
export function getMultiVMManager(): MultiVMManager {
  if (!multiVMInstance) {
    multiVMInstance = new MultiVMManager();
  }
  return multiVMInstance;
}

/**
 * Reset multi-VM manager (for testing)
 */
export function resetMultiVMManager(): void {
  if (multiVMInstance) {
    multiVMInstance.shutdown().catch(() => {});
  }
  multiVMInstance = null;
}
