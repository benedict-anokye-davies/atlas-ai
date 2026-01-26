/**
 * Atlas ML - Model Deployment Pipeline
 *
 * T5-308: Model deployment and lifecycle management
 *
 * Handles:
 * - Model validation and testing
 * - Staged rollout (canary, A/B)
 * - Performance monitoring
 * - Automatic rollback
 *
 * @module ml/fine-tuning/deployment-pipeline
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { getModelRegistry } from '../models';

const logger = createModuleLogger('DeploymentPipeline');

// =============================================================================
// Types
// =============================================================================

/**
 * Deployment stage
 */
export type DeploymentStage = 'validation' | 'canary' | 'staged' | 'production' | 'rollback';

/**
 * Deployment status
 */
export type DeploymentStatus =
  | 'pending'
  | 'validating'
  | 'deploying'
  | 'active'
  | 'rolling-back'
  | 'rolled-back'
  | 'failed';

/**
 * Validation result
 */
export interface ValidationResult {
  passed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    message?: string;
    duration?: number;
  }>;
  overallScore: number;
  timestamp: number;
}

/**
 * Deployment configuration
 */
export interface DeploymentConfig {
  /** Model ID to deploy */
  modelId: string;
  /** Target stage */
  targetStage: DeploymentStage;
  /** Canary percentage (0-100) */
  canaryPercentage?: number;
  /** Auto-rollback on error */
  autoRollback: boolean;
  /** Minimum success rate for promotion */
  minSuccessRate: number;
  /** Evaluation period in ms */
  evaluationPeriod: number;
  /** Required validation checks */
  requiredChecks: string[];
}

/**
 * Deployment record
 */
export interface Deployment {
  id: string;
  modelId: string;
  config: DeploymentConfig;
  status: DeploymentStatus;
  stage: DeploymentStage;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  validation?: ValidationResult;
  metrics?: {
    requests: number;
    successes: number;
    failures: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
  };
  previousModelId?: string;
  error?: string;
  logs: string[];
}

/**
 * Pipeline configuration
 */
export interface PipelineConfig {
  storagePath: string;
  defaultCanaryPercentage: number;
  defaultEvaluationPeriod: number;
  defaultMinSuccessRate: number;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  storagePath: '',
  defaultCanaryPercentage: 10,
  defaultEvaluationPeriod: 60 * 60 * 1000, // 1 hour
  defaultMinSuccessRate: 0.95,
};

/**
 * Pipeline events
 */
export interface PipelineEvents {
  'deployment-created': (deployment: Deployment) => void;
  'deployment-started': (deployment: Deployment) => void;
  'validation-complete': (deployment: Deployment, result: ValidationResult) => void;
  'deployment-promoted': (deployment: Deployment) => void;
  'deployment-completed': (deployment: Deployment) => void;
  'deployment-failed': (deployment: Deployment) => void;
  'rollback-started': (deployment: Deployment) => void;
  'rollback-completed': (deployment: Deployment) => void;
  error: (error: Error) => void;
}

// =============================================================================
// Deployment Pipeline
// =============================================================================

export class DeploymentPipeline extends EventEmitter {
  private config: PipelineConfig;
  private storagePath: string;
  private deployments: Map<string, Deployment> = new Map();
  private activeDeployments: Map<string, string> = new Map(); // modelType -> deploymentId
  private initialized: boolean = false;

  constructor(config?: Partial<PipelineConfig>) {
    super();
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };
    this.storagePath =
      this.config.storagePath || path.join(app.getPath('userData'), 'ml', 'deployments');
  }

  /**
   * Initialize the pipeline
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing DeploymentPipeline', { path: this.storagePath });

    await fs.ensureDir(this.storagePath);
    await this.loadDeployments();

    this.initialized = true;
    logger.info('DeploymentPipeline initialized', { deploymentCount: this.deployments.size });
  }

  /**
   * Load existing deployments
   */
  private async loadDeployments(): Promise<void> {
    const indexPath = path.join(this.storagePath, 'deployments.json');
    if (await fs.pathExists(indexPath)) {
      try {
        const data = await fs.readJson(indexPath);
        this.deployments = new Map(Object.entries(data.deployments || {}));
        this.activeDeployments = new Map(Object.entries(data.activeDeployments || {}));
      } catch (err) {
        logger.error('Failed to load deployments', { error: err });
      }
    }
  }

  /**
   * Save deployments
   */
  private async saveDeployments(): Promise<void> {
    const indexPath = path.join(this.storagePath, 'deployments.json');
    await fs.writeJson(
      indexPath,
      {
        deployments: Object.fromEntries(this.deployments),
        activeDeployments: Object.fromEntries(this.activeDeployments),
      },
      { spaces: 2 }
    );
  }

  // ===========================================================================
  // Deployment Management
  // ===========================================================================

  /**
   * Create a new deployment
   */
  async createDeployment(config: DeploymentConfig): Promise<Deployment> {
    const registry = getModelRegistry();
    await registry.initialize();

    const model = registry.getModel(config.modelId);
    if (!model) {
      throw new Error(`Model not found: ${config.modelId}`);
    }

    const id = `deploy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const deployment: Deployment = {
      id,
      modelId: config.modelId,
      config,
      status: 'pending',
      stage: 'validation',
      createdAt: Date.now(),
      logs: [],
    };

    this.deployments.set(id, deployment);
    await this.saveDeployments();

    this.emit('deployment-created', deployment);
    logger.info('Created deployment', { id, modelId: config.modelId });

    return deployment;
  }

  /**
   * Start a deployment
   */
  async startDeployment(deploymentId: string): Promise<void> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    if (deployment.status !== 'pending') {
      throw new Error(`Deployment is not pending: ${deployment.status}`);
    }

    try {
      deployment.status = 'validating';
      deployment.startedAt = Date.now();
      deployment.logs.push(`[${new Date().toISOString()}] Starting deployment...`);
      await this.saveDeployments();

      this.emit('deployment-started', deployment);

      // Step 1: Validate model
      const validationResult = await this.validateModel(deployment);
      deployment.validation = validationResult;

      this.emit('validation-complete', deployment, validationResult);

      if (!validationResult.passed) {
        deployment.status = 'failed';
        deployment.error = 'Validation failed';
        deployment.logs.push(`[${new Date().toISOString()}] Validation failed`);
        await this.saveDeployments();
        this.emit('deployment-failed', deployment);
        return;
      }

      deployment.logs.push(`[${new Date().toISOString()}] Validation passed`);

      // Step 2: Deploy based on target stage
      deployment.status = 'deploying';
      await this.saveDeployments();

      await this.executeDeployment(deployment);

      // Step 3: Complete deployment
      deployment.status = 'active';
      deployment.completedAt = Date.now();
      deployment.logs.push(`[${new Date().toISOString()}] Deployment completed`);

      await this.saveDeployments();
      this.emit('deployment-completed', deployment);

      logger.info('Deployment completed', {
        id: deploymentId,
        duration: deployment.completedAt - (deployment.startedAt || deployment.createdAt),
      });
    } catch (err) {
      deployment.status = 'failed';
      deployment.error = (err as Error).message;
      deployment.logs.push(`[${new Date().toISOString()}] ERROR: ${deployment.error}`);
      await this.saveDeployments();

      if (deployment.config.autoRollback && deployment.previousModelId) {
        await this.rollback(deploymentId);
      }

      this.emit('deployment-failed', deployment);
      throw err;
    }
  }

  /**
   * Validate a model before deployment
   */
  private async validateModel(deployment: Deployment): Promise<ValidationResult> {
    const checks: ValidationResult['checks'] = [];
    const startTime = Date.now();

    const registry = getModelRegistry();
    const model = registry.getModel(deployment.modelId);

    if (!model) {
      return {
        passed: false,
        checks: [{ name: 'model-exists', passed: false, message: 'Model not found' }],
        overallScore: 0,
        timestamp: Date.now(),
      };
    }

    // Check 1: Model exists and is ready
    checks.push({
      name: 'model-exists',
      passed: true,
      message: 'Model found in registry',
      duration: Date.now() - startTime,
    });

    // Check 2: Model file exists
    const modelPath = model.path ? path.join(app.getPath('userData'), 'models', model.path) : null;
    const fileExists = modelPath ? await fs.pathExists(modelPath) : false;

    checks.push({
      name: 'file-exists',
      passed: fileExists || model.status === 'ready',
      message: fileExists ? 'Model file found' : 'Model file not found (may be remote)',
      duration: Date.now() - startTime,
    });

    // Check 3: Model has metrics
    const hasMetrics = !!model.metrics && Object.keys(model.metrics).length > 0;
    checks.push({
      name: 'has-metrics',
      passed: hasMetrics,
      message: hasMetrics ? 'Performance metrics available' : 'No metrics found',
      duration: Date.now() - startTime,
    });

    // Check 4: Model meets minimum quality
    const meetsQuality = (model.metrics?.accuracy || 0) >= 0.7;
    checks.push({
      name: 'quality-threshold',
      passed: meetsQuality,
      message: meetsQuality
        ? `Accuracy ${((model.metrics?.accuracy || 0) * 100).toFixed(1)}% meets threshold`
        : 'Model does not meet quality threshold',
      duration: Date.now() - startTime,
    });

    // Check required checks
    const requiredPassed = deployment.config.requiredChecks.every((checkName) => {
      const check = checks.find((c) => c.name === checkName);
      return check?.passed ?? false;
    });

    const passedChecks = checks.filter((c) => c.passed).length;
    const overallScore = passedChecks / checks.length;

    return {
      passed: requiredPassed && overallScore >= 0.75,
      checks,
      overallScore,
      timestamp: Date.now(),
    };
  }

  /**
   * Execute the deployment
   */
  private async executeDeployment(deployment: Deployment): Promise<void> {
    const registry = getModelRegistry();
    const model = registry.getModel(deployment.modelId);

    if (!model) {
      throw new Error('Model not found');
    }

    // Get current active model
    const currentActive = registry.getActiveModel(model.type);
    if (currentActive) {
      deployment.previousModelId = currentActive.id;
    }

    switch (deployment.config.targetStage) {
      case 'validation':
        // Already validated, just mark as complete
        break;

      case 'canary':
        deployment.logs.push(
          `[${new Date().toISOString()}] Starting canary deployment (${deployment.config.canaryPercentage || this.config.defaultCanaryPercentage}%)`
        );
        // In a full implementation, this would set up traffic splitting
        break;

      case 'staged':
        deployment.logs.push(`[${new Date().toISOString()}] Starting staged rollout`);
        // Gradually increase traffic
        break;

      case 'production':
        deployment.logs.push(`[${new Date().toISOString()}] Deploying to production`);
        // Activate model
        await registry.activateModel(deployment.modelId);
        deployment.stage = 'production';
        break;
    }

    await this.saveDeployments();
  }

  /**
   * Promote deployment to next stage
   */
  async promoteDeployment(deploymentId: string): Promise<void> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    const stageOrder: DeploymentStage[] = ['validation', 'canary', 'staged', 'production'];
    const currentIndex = stageOrder.indexOf(deployment.stage);

    if (currentIndex >= stageOrder.length - 1) {
      throw new Error('Deployment is already at production stage');
    }

    const nextStage = stageOrder[currentIndex + 1];
    deployment.stage = nextStage;
    deployment.config.targetStage = nextStage;

    deployment.logs.push(`[${new Date().toISOString()}] Promoted to ${nextStage} stage`);

    if (nextStage === 'production') {
      const registry = getModelRegistry();
      await registry.activateModel(deployment.modelId);
    }

    await this.saveDeployments();
    this.emit('deployment-promoted', deployment);

    logger.info('Promoted deployment', { id: deploymentId, stage: nextStage });
  }

  /**
   * Rollback a deployment
   */
  async rollback(deploymentId: string): Promise<void> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    if (!deployment.previousModelId) {
      throw new Error('No previous model to rollback to');
    }

    deployment.status = 'rolling-back';
    deployment.logs.push(`[${new Date().toISOString()}] Starting rollback...`);
    await this.saveDeployments();

    this.emit('rollback-started', deployment);

    try {
      const registry = getModelRegistry();
      await registry.activateModel(deployment.previousModelId);

      deployment.status = 'rolled-back';
      deployment.stage = 'rollback';
      deployment.logs.push(
        `[${new Date().toISOString()}] Rolled back to model ${deployment.previousModelId}`
      );

      await this.saveDeployments();
      this.emit('rollback-completed', deployment);

      logger.info('Rollback completed', {
        deploymentId,
        previousModelId: deployment.previousModelId,
      });
    } catch (err) {
      deployment.status = 'failed';
      deployment.error = `Rollback failed: ${(err as Error).message}`;
      deployment.logs.push(`[${new Date().toISOString()}] ERROR: ${deployment.error}`);
      await this.saveDeployments();
      throw err;
    }
  }

  // ===========================================================================
  // Metrics & Monitoring
  // ===========================================================================

  /**
   * Record request metrics
   */
  async recordMetrics(
    deploymentId: string,
    metrics: { success: boolean; latencyMs: number }
  ): Promise<void> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) return;

    if (!deployment.metrics) {
      deployment.metrics = {
        requests: 0,
        successes: 0,
        failures: 0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
      };
    }

    deployment.metrics.requests++;
    if (metrics.success) {
      deployment.metrics.successes++;
    } else {
      deployment.metrics.failures++;
    }

    // Update average latency (simple moving average)
    const totalLatency =
      deployment.metrics.avgLatencyMs * (deployment.metrics.requests - 1) + metrics.latencyMs;
    deployment.metrics.avgLatencyMs = totalLatency / deployment.metrics.requests;

    // Check for auto-rollback
    if (deployment.config.autoRollback) {
      const successRate = deployment.metrics.successes / deployment.metrics.requests;
      if (deployment.metrics.requests >= 100 && successRate < deployment.config.minSuccessRate) {
        logger.warn('Success rate below threshold, triggering rollback', {
          deploymentId,
          successRate,
          threshold: deployment.config.minSuccessRate,
        });
        await this.rollback(deploymentId);
      }
    }

    await this.saveDeployments();
  }

  /**
   * Get deployment by ID
   */
  getDeployment(deploymentId: string): Deployment | null {
    return this.deployments.get(deploymentId) || null;
  }

  /**
   * Get all deployments
   */
  getAllDeployments(): Deployment[] {
    return Array.from(this.deployments.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get active deployment for a model type
   */
  getActiveDeployment(modelType: string): Deployment | null {
    const deploymentId = this.activeDeployments.get(modelType);
    if (!deploymentId) return null;
    return this.deployments.get(deploymentId) || null;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.saveDeployments();
    this.deployments.clear();
    this.activeDeployments.clear();
    this.initialized = false;
    logger.info('DeploymentPipeline cleaned up');
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: DeploymentPipeline | null = null;

/**
 * Get the DeploymentPipeline singleton
 */
export function getDeploymentPipeline(): DeploymentPipeline {
  if (!instance) {
    instance = new DeploymentPipeline();
  }
  return instance;
}

/**
 * Initialize the DeploymentPipeline
 */
export async function initializeDeploymentPipeline(
  config?: Partial<PipelineConfig>
): Promise<DeploymentPipeline> {
  if (!instance) {
    instance = new DeploymentPipeline(config);
  }
  await instance.initialize();
  return instance;
}

/**
 * Cleanup the DeploymentPipeline
 */
export async function cleanupDeploymentPipeline(): Promise<void> {
  if (instance) {
    await instance.cleanup();
    instance = null;
  }
}
