/**
 * Atlas Desktop - Forgetting Mechanism
 * Intelligent memory decay and forgetting for sustainable memory management
 *
 * Features:
 * - Time-based memory decay (older memories fade)
 * - Access-based reinforcement (used memories strengthen)
 * - Importance scoring to protect critical memories
 * - Configurable retention policies
 * - Manual "forget this" command
 * - GDPR-compliant data deletion
 * - Memory consolidation during idle
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { createModuleLogger } from '../utils/logger';
import { MemoryEntry, MemoryType, MemoryManager, getMemoryManager } from './index';
import { MemoryCategory, getImportanceScorer } from './importance-scorer';
import { LanceDBVectorStore } from './vector-store/lancedb';

const logger = createModuleLogger('ForgettingManager');

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Retention policy levels
 */
export type RetentionLevel = 'ephemeral' | 'short_term' | 'medium_term' | 'long_term' | 'permanent';

/**
 * Decay curve types for different memory characteristics
 */
export type DecayCurve = 'exponential' | 'linear' | 'stepped' | 'logarithmic';

/**
 * Retention policy for a specific memory type/category
 */
export interface RetentionPolicy {
  /** Memory types this policy applies to */
  memoryTypes?: MemoryType[];
  /** Memory categories this policy applies to */
  categories?: MemoryCategory[];
  /** Retention level */
  level: RetentionLevel;
  /** Base retention period in hours (before decay starts) */
  baseRetentionHours: number;
  /** Maximum retention period in hours (after which memory is eligible for deletion) */
  maxRetentionHours: number;
  /** Decay curve type */
  decayCurve: DecayCurve;
  /** Half-life for decay in hours (for exponential decay) */
  halfLifeHours: number;
  /** Minimum importance score to protect from decay */
  protectionThreshold: number;
  /** Whether memories can be consolidated instead of deleted */
  allowConsolidation: boolean;
  /** Tags that trigger this policy */
  triggerTags?: string[];
}

/**
 * GDPR deletion request
 */
export interface GDPRDeletionRequest {
  /** Unique request ID */
  requestId: string;
  /** Request timestamp */
  requestedAt: number;
  /** Type of deletion: specific IDs or scope-based */
  type: 'specific' | 'all' | 'date_range' | 'category';
  /** Specific memory IDs to delete (for 'specific' type) */
  memoryIds?: string[];
  /** Date range for deletion (for 'date_range' type) */
  dateRange?: { start: number; end: number };
  /** Categories to delete (for 'category' type) */
  categories?: MemoryCategory[];
  /** Whether to include vector store data */
  includeVectorStore: boolean;
  /** Whether to include conversation history */
  includeConversations: boolean;
  /** Status of the request */
  status: 'pending' | 'processing' | 'completed' | 'failed';
  /** Completion timestamp */
  completedAt?: number;
  /** Number of items deleted */
  deletedCount?: number;
  /** Error message if failed */
  error?: string;
  /** Deletion certificate hash for audit */
  certificateHash?: string;
}

/**
 * Decay calculation result
 */
export interface DecayResult {
  /** Memory ID */
  memoryId: string;
  /** Original importance score */
  originalScore: number;
  /** Decayed importance score */
  decayedScore: number;
  /** Age in hours */
  ageHours: number;
  /** Access count since creation */
  accessCount: number;
  /** Last access age in hours */
  lastAccessAgeHours: number;
  /** Applied retention policy */
  policy: RetentionLevel;
  /** Action taken */
  action: 'kept' | 'decayed' | 'flagged_for_deletion' | 'flagged_for_consolidation' | 'protected';
  /** Reason for action */
  reason: string;
}

/**
 * Forgetting batch result
 */
export interface ForgettingBatchResult {
  /** Memories processed */
  processed: number;
  /** Memories decayed */
  decayed: number;
  /** Memories deleted */
  deleted: number;
  /** Memories consolidated */
  consolidated: number;
  /** Memories protected */
  protected: number;
  /** Processing duration in ms */
  durationMs: number;
  /** Individual results */
  results: DecayResult[];
  /** Errors encountered */
  errors: Array<{ memoryId: string; error: string }>;
}

/**
 * Forget command options
 */
export interface ForgetOptions {
  /** Specific memory IDs to forget */
  memoryIds?: string[];
  /** Forget memories matching content pattern */
  contentPattern?: string | RegExp;
  /** Forget memories with specific tags */
  tags?: string[];
  /** Forget memories in date range */
  dateRange?: { start: number; end: number };
  /** Force deletion even if protected */
  force?: boolean;
  /** Reason for forgetting (for audit) */
  reason?: string;
  /** Permanently delete (no recovery) */
  permanent?: boolean;
}

/**
 * Forgetting manager configuration
 */
export interface ForgettingConfig {
  /** Enable automatic decay processing */
  enableAutoDecay: boolean;
  /** Decay processing interval in ms */
  decayIntervalMs: number;
  /** Enable idle-time processing */
  enableIdleProcessing: boolean;
  /** Idle time before triggering processing (ms) */
  idleThresholdMs: number;
  /** Default retention policies */
  defaultPolicies: RetentionPolicy[];
  /** Minimum score before eligible for deletion */
  deletionThreshold: number;
  /** Minimum score before eligible for consolidation */
  consolidationThreshold: number;
  /** Access boost per access (reinforcement learning) */
  accessBoostFactor: number;
  /** Maximum access boost cap */
  maxAccessBoost: number;
  /** Enable GDPR audit logging */
  enableGDPRAudit: boolean;
  /** GDPR audit log path */
  gdprAuditPath: string;
  /** Batch size for decay processing */
  batchSize: number;
}

/**
 * Forgetting manager events
 */
export interface ForgettingEvents {
  /** Decay cycle started */
  'decay-started': (memoryCount: number) => void;
  /** Decay cycle completed */
  'decay-completed': (result: ForgettingBatchResult) => void;
  /** Memory forgotten */
  'memory-forgotten': (memoryId: string, reason: string) => void;
  /** Memory protected */
  'memory-protected': (memoryId: string, score: number) => void;
  /** Memory reinforced */
  'memory-reinforced': (memoryId: string, oldScore: number, newScore: number) => void;
  /** GDPR request received */
  'gdpr-request': (request: GDPRDeletionRequest) => void;
  /** GDPR request completed */
  'gdpr-completed': (request: GDPRDeletionRequest) => void;
  /** Idle processing triggered */
  'idle-processing': () => void;
  /** Error occurred */
  'error': (error: Error, context?: string) => void;
}

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Default retention policies
 */
const DEFAULT_RETENTION_POLICIES: RetentionPolicy[] = [
  // Permanent: User facts, preferences, instructions
  {
    categories: ['user_fact', 'user_preference', 'instruction'],
    level: 'permanent',
    baseRetentionHours: Infinity,
    maxRetentionHours: Infinity,
    decayCurve: 'linear',
    halfLifeHours: Infinity,
    protectionThreshold: 0.0,
    allowConsolidation: false,
  },
  // Long-term: Decisions, corrections, feedback
  {
    categories: ['decision', 'correction', 'feedback'],
    level: 'long_term',
    baseRetentionHours: 720, // 30 days
    maxRetentionHours: 8760, // 1 year
    decayCurve: 'exponential',
    halfLifeHours: 336, // 2 weeks
    protectionThreshold: 0.7,
    allowConsolidation: true,
  },
  // Medium-term: Tasks, agreements
  {
    categories: ['task', 'agreement'],
    level: 'medium_term',
    baseRetentionHours: 168, // 1 week
    maxRetentionHours: 2160, // 3 months
    decayCurve: 'exponential',
    halfLifeHours: 168, // 1 week
    protectionThreshold: 0.5,
    allowConsolidation: true,
  },
  // Short-term: Questions
  {
    categories: ['question'],
    level: 'short_term',
    baseRetentionHours: 24, // 1 day
    maxRetentionHours: 720, // 30 days
    decayCurve: 'exponential',
    halfLifeHours: 72, // 3 days
    protectionThreshold: 0.3,
    allowConsolidation: true,
  },
  // Ephemeral: Casual conversation
  {
    categories: ['casual'],
    level: 'ephemeral',
    baseRetentionHours: 1,
    maxRetentionHours: 168, // 1 week
    decayCurve: 'exponential',
    halfLifeHours: 24, // 1 day
    protectionThreshold: 0.2,
    allowConsolidation: true,
  },
  // Default policy for unmatched memories
  {
    memoryTypes: ['conversation', 'fact', 'preference', 'context'],
    level: 'medium_term',
    baseRetentionHours: 72, // 3 days
    maxRetentionHours: 1440, // 2 months
    decayCurve: 'exponential',
    halfLifeHours: 168, // 1 week
    protectionThreshold: 0.4,
    allowConsolidation: true,
  },
];

/**
 * Default forgetting configuration
 */
const DEFAULT_FORGETTING_CONFIG: ForgettingConfig = {
  enableAutoDecay: true,
  decayIntervalMs: 3600000, // 1 hour
  enableIdleProcessing: true,
  idleThresholdMs: 300000, // 5 minutes
  defaultPolicies: DEFAULT_RETENTION_POLICIES,
  deletionThreshold: 0.05,
  consolidationThreshold: 0.2,
  accessBoostFactor: 0.1,
  maxAccessBoost: 0.5,
  enableGDPRAudit: true,
  gdprAuditPath: path.join(
    process.env.HOME || process.env.USERPROFILE || '.',
    '.atlas',
    'gdpr-audit.log'
  ),
  batchSize: 100,
};

// ============================================================================
// Forgetting Manager Implementation
// ============================================================================

/**
 * Forgetting Manager
 * Handles intelligent memory decay, reinforcement, and deletion
 */
export class ForgettingManager extends EventEmitter {
  private config: ForgettingConfig;
  private decayTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private lastActivityTime: number = Date.now();
  private isProcessing: boolean = false;
  private memoryManager: MemoryManager | null = null;
  private vectorStore: LanceDBVectorStore | null = null;
  private pendingGDPRRequests: Map<string, GDPRDeletionRequest> = new Map();
  private accessHistory: Map<string, { count: number; lastAccess: number }> = new Map();

  constructor(config?: Partial<ForgettingConfig>) {
    super();
    this.config = { ...DEFAULT_FORGETTING_CONFIG, ...config };

    logger.info('ForgettingManager initialized', {
      enableAutoDecay: this.config.enableAutoDecay,
      decayIntervalMs: this.config.decayIntervalMs,
      enableIdleProcessing: this.config.enableIdleProcessing,
    });
  }

  /**
   * Initialize with memory manager and vector store
   */
  async initialize(
    memoryManager?: MemoryManager,
    vectorStore?: LanceDBVectorStore
  ): Promise<void> {
    this.memoryManager = memoryManager || (await getMemoryManager());
    this.vectorStore = vectorStore || null;

    // Ensure GDPR audit directory exists
    if (this.config.enableGDPRAudit) {
      const auditDir = path.dirname(this.config.gdprAuditPath);
      await fs.promises.mkdir(auditDir, { recursive: true });
    }

    logger.info('ForgettingManager initialized with stores');
  }

  /**
   * Start automatic decay processing
   */
  start(): void {
    if (this.decayTimer) {
      logger.warn('ForgettingManager already running');
      return;
    }

    if (this.config.enableAutoDecay) {
      this.decayTimer = setInterval(() => {
        this.processDecay('scheduled').catch((err) => {
          this.emit('error', err as Error, 'scheduled-decay');
        });
      }, this.config.decayIntervalMs);
    }

    if (this.config.enableIdleProcessing) {
      this.resetIdleTimer();
    }

    logger.info('ForgettingManager started');
  }

  /**
   * Stop automatic processing
   */
  stop(): void {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    logger.info('ForgettingManager stopped');
  }

  /**
   * Record activity to reset idle timer
   */
  recordActivity(): void {
    this.lastActivityTime = Date.now();
    this.resetIdleTimer();
  }

  /**
   * Record memory access for reinforcement
   */
  recordAccess(memoryId: string): void {
    const history = this.accessHistory.get(memoryId) || { count: 0, lastAccess: 0 };
    history.count++;
    history.lastAccess = Date.now();
    this.accessHistory.set(memoryId, history);

    // Trigger reinforcement
    this.reinforceMemory(memoryId, history.count);
  }

  // ==========================================================================
  // Decay Algorithms
  // ==========================================================================

  /**
   * Calculate decay based on curve type
   */
  private calculateDecay(
    originalScore: number,
    ageHours: number,
    policy: RetentionPolicy
  ): number {
    // If age is less than base retention, no decay
    if (ageHours < policy.baseRetentionHours) {
      return originalScore;
    }

    // Calculate effective age (time since base retention ended)
    const effectiveAge = ageHours - policy.baseRetentionHours;

    let decayedScore: number;

    switch (policy.decayCurve) {
      case 'exponential': {
        // Exponential decay: score * 0.5^(age/halfLife)
        decayedScore = originalScore * Math.pow(0.5, effectiveAge / policy.halfLifeHours);
        break;
      }

      case 'linear': {
        // Linear decay: score - (age / maxRetention) * score
        const linearFactor = effectiveAge / (policy.maxRetentionHours - policy.baseRetentionHours);
        decayedScore = originalScore * (1 - Math.min(1, linearFactor));
        break;
      }

      case 'stepped': {
        // Stepped decay: discrete steps at 25%, 50%, 75%, 100% of max retention
        const progress = effectiveAge / (policy.maxRetentionHours - policy.baseRetentionHours);
        if (progress < 0.25) decayedScore = originalScore;
        else if (progress < 0.5) decayedScore = originalScore * 0.75;
        else if (progress < 0.75) decayedScore = originalScore * 0.5;
        else if (progress < 1.0) decayedScore = originalScore * 0.25;
        else decayedScore = originalScore * 0.1;
        break;
      }

      case 'logarithmic': {
        // Logarithmic decay: slower initial decay, faster later
        const logFactor = Math.log(1 + effectiveAge / policy.halfLifeHours) / Math.log(2);
        decayedScore = originalScore / (1 + logFactor);
        break;
      }

      default:
        decayedScore = originalScore;
    }

    // Apply minimum threshold
    return Math.max(this.config.deletionThreshold * 0.5, decayedScore);
  }

  /**
   * Calculate access-based reinforcement boost
   */
  private calculateAccessBoost(accessCount: number, lastAccessAgeHours: number): number {
    // Base boost from access count (diminishing returns)
    const countBoost = Math.min(
      this.config.maxAccessBoost,
      Math.log2(1 + accessCount) * this.config.accessBoostFactor
    );

    // Recency multiplier (recent accesses count more)
    const recencyMultiplier = lastAccessAgeHours < 24 ? 1.0 : 1 / Math.log2(1 + lastAccessAgeHours / 24);

    return countBoost * recencyMultiplier;
  }

  /**
   * Get applicable retention policy for a memory
   */
  private getRetentionPolicy(
    memoryType: MemoryType,
    category?: MemoryCategory,
    tags?: string[]
  ): RetentionPolicy {
    // Find matching policy by category first
    if (category) {
      const categoryPolicy = this.config.defaultPolicies.find(
        (p) => p.categories?.includes(category)
      );
      if (categoryPolicy) return categoryPolicy;
    }

    // Check for tag-triggered policies
    if (tags && tags.length > 0) {
      const tagPolicy = this.config.defaultPolicies.find(
        (p) => p.triggerTags?.some((t) => tags.includes(t))
      );
      if (tagPolicy) return tagPolicy;
    }

    // Fall back to memory type
    const typePolicy = this.config.defaultPolicies.find(
      (p) => p.memoryTypes?.includes(memoryType)
    );
    if (typePolicy) return typePolicy;

    // Return default policy (last one in list)
    return this.config.defaultPolicies[this.config.defaultPolicies.length - 1];
  }

  // ==========================================================================
  // Memory Processing
  // ==========================================================================

  /**
   * Process decay for all memories
   */
  async processDecay(reason: string): Promise<ForgettingBatchResult> {
    if (this.isProcessing) {
      logger.warn('Decay processing already in progress');
      return this.createEmptyResult();
    }

    this.isProcessing = true;
    const startTime = Date.now();
    const results: DecayResult[] = [];
    const errors: Array<{ memoryId: string; error: string }> = [];

    try {
      // Get all memories to process using the public searchEntries method
      const memories: MemoryEntry[] = this.memoryManager
        ? this.memoryManager.searchEntries({})
        : [];

      this.emit('decay-started', memories.length);
      logger.info('Starting decay processing', { reason, memoryCount: memories.length });

      const scorer = getImportanceScorer();
      let decayed = 0;
      let deleted = 0;
      let consolidated = 0;
      let protected_ = 0;

      // Process in batches
      for (let i = 0; i < memories.length; i += this.config.batchSize) {
        const batch = memories.slice(i, i + this.config.batchSize) as MemoryEntry[];

        for (const memory of batch) {
          try {
            const result = await this.processMemoryDecay(memory, scorer);
            results.push(result);

            switch (result.action) {
              case 'decayed':
                decayed++;
                break;
              case 'flagged_for_deletion':
                deleted++;
                await this.deleteMemory(memory.id, 'decay');
                break;
              case 'flagged_for_consolidation':
                consolidated++;
                break;
              case 'protected':
                protected_++;
                break;
            }
          } catch (err) {
            errors.push({ memoryId: memory.id, error: (err as Error).message });
          }
        }
      }

      // Process vector store if available
      if (this.vectorStore && this.vectorStore.isReady()) {
        const vectorResults = await this.processVectorStoreDecay();
        results.push(...vectorResults.results);
        decayed += vectorResults.decayed;
        deleted += vectorResults.deleted;
        consolidated += vectorResults.consolidated;
        protected_ += vectorResults.protected;
      }

      const result: ForgettingBatchResult = {
        processed: results.length,
        decayed,
        deleted,
        consolidated,
        protected: protected_,
        durationMs: Date.now() - startTime,
        results,
        errors,
      };

      this.emit('decay-completed', result);
      logger.info('Decay processing completed', {
        reason,
        processed: result.processed,
        decayed,
        deleted,
        consolidated,
        protected: protected_,
        durationMs: result.durationMs,
      });

      return result;
    } catch (error) {
      this.emit('error', error as Error, 'process-decay');
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process decay for a single memory entry
   */
  private async processMemoryDecay(
    memory: MemoryEntry,
    scorer: ReturnType<typeof getImportanceScorer>
  ): Promise<DecayResult> {
    const now = Date.now();
    const ageHours = (now - memory.createdAt) / (1000 * 60 * 60);
    const lastAccessAgeHours = (now - memory.accessedAt) / (1000 * 60 * 60);

    // Get scored memory for category detection
    const scored = scorer.scoreMemory(memory);
    const category = scored.category;

    // Get applicable retention policy
    const policy = this.getRetentionPolicy(memory.type, category, memory.tags);

    // Check if permanently protected
    if (policy.level === 'permanent') {
      return {
        memoryId: memory.id,
        originalScore: memory.importance,
        decayedScore: memory.importance,
        ageHours,
        accessCount: 0,
        lastAccessAgeHours,
        policy: policy.level,
        action: 'protected',
        reason: 'Permanent retention policy',
      };
    }

    // Calculate base decay
    let decayedScore = this.calculateDecay(memory.importance, ageHours, policy);

    // Apply access reinforcement
    const accessHistory = this.accessHistory.get(memory.id);
    if (accessHistory) {
      const accessBoost = this.calculateAccessBoost(
        accessHistory.count,
        (now - accessHistory.lastAccess) / (1000 * 60 * 60)
      );
      decayedScore = Math.min(1, decayedScore + accessBoost);
    }

    // Check protection threshold
    if (decayedScore >= policy.protectionThreshold) {
      return {
        memoryId: memory.id,
        originalScore: memory.importance,
        decayedScore,
        ageHours,
        accessCount: accessHistory?.count || 0,
        lastAccessAgeHours,
        policy: policy.level,
        action: 'protected',
        reason: `Score ${decayedScore.toFixed(2)} above threshold ${policy.protectionThreshold}`,
      };
    }

    // Check for deletion eligibility
    if (decayedScore <= this.config.deletionThreshold) {
      if (ageHours > policy.maxRetentionHours) {
        return {
          memoryId: memory.id,
          originalScore: memory.importance,
          decayedScore,
          ageHours,
          accessCount: accessHistory?.count || 0,
          lastAccessAgeHours,
          policy: policy.level,
          action: 'flagged_for_deletion',
          reason: `Score ${decayedScore.toFixed(2)} below threshold, age ${ageHours.toFixed(0)}h exceeds max ${policy.maxRetentionHours}h`,
        };
      }
    }

    // Check for consolidation eligibility
    if (decayedScore <= this.config.consolidationThreshold && policy.allowConsolidation) {
      return {
        memoryId: memory.id,
        originalScore: memory.importance,
        decayedScore,
        ageHours,
        accessCount: accessHistory?.count || 0,
        lastAccessAgeHours,
        policy: policy.level,
        action: 'flagged_for_consolidation',
        reason: `Score ${decayedScore.toFixed(2)} below consolidation threshold ${this.config.consolidationThreshold}`,
      };
    }

    // Apply decay to memory
    memory.importance = decayedScore;

    return {
      memoryId: memory.id,
      originalScore: scored.rawScore,
      decayedScore,
      ageHours,
      accessCount: accessHistory?.count || 0,
      lastAccessAgeHours,
      policy: policy.level,
      action: 'decayed',
      reason: `Applied ${policy.decayCurve} decay`,
    };
  }

  /**
   * Process decay for vector store documents
   */
  private async processVectorStoreDecay(): Promise<{
    results: DecayResult[];
    decayed: number;
    deleted: number;
    consolidated: number;
    protected: number;
  }> {
    if (!this.vectorStore || !this.vectorStore.isReady()) {
      return { results: [], decayed: 0, deleted: 0, consolidated: 0, protected: 0 };
    }

    const results: DecayResult[] = [];
    let decayed = 0;
    let deleted = 0;
    let consolidated = 0;
    let protected_ = 0;

    // Get cleanup candidates from vector store
    const candidates = await this.vectorStore.getCleanupCandidates(this.config.batchSize);

    for (const doc of candidates) {
      const now = Date.now();
      const ageHours = (now - doc.createdAt) / (1000 * 60 * 60);
      const lastAccessAgeHours = (now - doc.accessedAt) / (1000 * 60 * 60);

      // Get policy based on source type
      const memoryType = doc.metadata.sourceType as MemoryType;
      const policy = this.getRetentionPolicy(memoryType, undefined, doc.metadata.tags);

      // Calculate decayed score
      let decayedScore = this.calculateDecay(doc.metadata.importance, ageHours, policy);

      // Apply access boost
      const accessHistory = this.accessHistory.get(doc.id);
      if (accessHistory) {
        const boost = this.calculateAccessBoost(
          accessHistory.count,
          (now - accessHistory.lastAccess) / (1000 * 60 * 60)
        );
        decayedScore = Math.min(1, decayedScore + boost);
      }

      // Determine action
      let action: DecayResult['action'] = 'kept';
      let reason = 'Within acceptable parameters';

      if (decayedScore >= policy.protectionThreshold) {
        action = 'protected';
        reason = `Score ${decayedScore.toFixed(2)} above threshold`;
        protected_++;
      } else if (decayedScore <= this.config.deletionThreshold && ageHours > policy.maxRetentionHours) {
        action = 'flagged_for_deletion';
        reason = `Score ${decayedScore.toFixed(2)} below deletion threshold`;
        await this.vectorStore.delete(doc.id);
        deleted++;
      } else if (decayedScore <= this.config.consolidationThreshold && policy.allowConsolidation) {
        action = 'flagged_for_consolidation';
        reason = `Score ${decayedScore.toFixed(2)} below consolidation threshold`;
        consolidated++;
      } else if (decayedScore < doc.metadata.importance) {
        action = 'decayed';
        reason = `Applied ${policy.decayCurve} decay`;
        // Update metadata with new importance
        await this.vectorStore.updateMetadata(doc.id, { importance: decayedScore });
        decayed++;
      }

      results.push({
        memoryId: doc.id,
        originalScore: doc.metadata.importance,
        decayedScore,
        ageHours,
        accessCount: doc.metadata.accessCount,
        lastAccessAgeHours,
        policy: policy.level,
        action,
        reason,
      });
    }

    return { results, decayed, deleted, consolidated, protected: protected_ };
  }

  // ==========================================================================
  // Memory Reinforcement
  // ==========================================================================

  /**
   * Reinforce a memory based on access
   */
  private async reinforceMemory(memoryId: string, accessCount: number): Promise<void> {
    const boost = this.calculateAccessBoost(accessCount, 0);

    // Update memory manager entry
    if (this.memoryManager) {
      const entry = this.memoryManager.getEntry(memoryId);
      if (entry) {
        const oldScore = entry.importance;
        entry.importance = Math.min(1, entry.importance + boost);
        this.emit('memory-reinforced', memoryId, oldScore, entry.importance);
        logger.debug('Memory reinforced', {
          memoryId,
          oldScore: oldScore.toFixed(2),
          newScore: entry.importance.toFixed(2),
          boost: boost.toFixed(2),
        });
      }
    }

    // Update vector store if available
    if (this.vectorStore && this.vectorStore.isReady()) {
      const doc = await this.vectorStore.get(memoryId);
      if (doc) {
        const oldScore = doc.metadata.importance;
        const newScore = Math.min(1, oldScore + boost);
        await this.vectorStore.updateMetadata(memoryId, {
          importance: newScore,
          accessCount: doc.metadata.accessCount + 1,
        });
      }
    }
  }

  // ==========================================================================
  // Manual Forget Command
  // ==========================================================================

  /**
   * Manually forget memories
   */
  async forget(options: ForgetOptions): Promise<ForgettingBatchResult> {
    const startTime = Date.now();
    const results: DecayResult[] = [];
    const errors: Array<{ memoryId: string; error: string }> = [];
    let deleted = 0;

    logger.info('Manual forget requested', {
      memoryIds: options.memoryIds?.length || 0,
      hasPattern: !!options.contentPattern,
      hasTags: !!options.tags?.length,
      hasDateRange: !!options.dateRange,
      force: options.force,
      reason: options.reason,
    });

    try {
      // Collect memories to forget
      const toForget: string[] = [];

      // Add specific IDs
      if (options.memoryIds) {
        toForget.push(...options.memoryIds);
      }

      // Find by content pattern
      if (options.contentPattern && this.memoryManager) {
        const pattern =
          typeof options.contentPattern === 'string'
            ? new RegExp(options.contentPattern, 'i')
            : options.contentPattern;

        const entries = this.memoryManager.searchEntries({});
        for (const entry of entries) {
          if (pattern.test(entry.content)) {
            toForget.push(entry.id);
          }
        }
      }

      // Find by tags
      if (options.tags && this.memoryManager) {
        const entries = this.memoryManager.searchEntries({ tags: options.tags });
        for (const entry of entries) {
          toForget.push(entry.id);
        }
      }

      // Find by date range
      if (options.dateRange && this.memoryManager) {
        const entries = this.memoryManager.searchEntries({});
        for (const entry of entries) {
          if (
            entry.createdAt >= options.dateRange.start &&
            entry.createdAt <= options.dateRange.end
          ) {
            toForget.push(entry.id);
          }
        }
      }

      // Deduplicate
      const uniqueIds = Array.from(new Set(toForget));

      // Process forgetting
      for (const memoryId of uniqueIds) {
        try {
          const entry = this.memoryManager?.getEntry(memoryId);
          const isProtected = entry ? this.isMemoryProtected(entry) : false;

          if (isProtected && !options.force) {
            results.push({
              memoryId,
              originalScore: entry?.importance || 0,
              decayedScore: entry?.importance || 0,
              ageHours: 0,
              accessCount: 0,
              lastAccessAgeHours: 0,
              policy: 'permanent',
              action: 'protected',
              reason: 'Memory is protected, use force=true to override',
            });
            this.emit('memory-protected', memoryId, entry?.importance || 0);
            continue;
          }

          await this.deleteMemory(memoryId, options.reason || 'manual', options.permanent);
          deleted++;

          results.push({
            memoryId,
            originalScore: entry?.importance || 0,
            decayedScore: 0,
            ageHours: entry ? (Date.now() - entry.createdAt) / (1000 * 60 * 60) : 0,
            accessCount: 0,
            lastAccessAgeHours: 0,
            policy: 'ephemeral',
            action: 'flagged_for_deletion',
            reason: options.reason || 'Manual forget command',
          });

          this.emit('memory-forgotten', memoryId, options.reason || 'manual');
        } catch (err) {
          errors.push({ memoryId, error: (err as Error).message });
        }
      }

      const result: ForgettingBatchResult = {
        processed: uniqueIds.length,
        decayed: 0,
        deleted,
        consolidated: 0,
        protected: results.filter((r) => r.action === 'protected').length,
        durationMs: Date.now() - startTime,
        results,
        errors,
      };

      logger.info('Manual forget completed', {
        processed: result.processed,
        deleted: result.deleted,
        protected: result.protected,
        errors: errors.length,
      });

      return result;
    } catch (error) {
      this.emit('error', error as Error, 'manual-forget');
      throw error;
    }
  }

  /**
   * Check if a memory is protected
   */
  private isMemoryProtected(memory: MemoryEntry): boolean {
    const scorer = getImportanceScorer();
    const scored = scorer.scoreMemory(memory);
    const policy = this.getRetentionPolicy(memory.type, scored.category, memory.tags);
    return policy.level === 'permanent' || memory.importance >= policy.protectionThreshold;
  }

  // ==========================================================================
  // GDPR Compliance
  // ==========================================================================

  /**
   * Submit GDPR deletion request
   */
  async submitGDPRDeletionRequest(
    request: Omit<GDPRDeletionRequest, 'requestId' | 'requestedAt' | 'status'>
  ): Promise<string> {
    const fullRequest: GDPRDeletionRequest = {
      ...request,
      requestId: `gdpr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      requestedAt: Date.now(),
      status: 'pending',
    };

    this.pendingGDPRRequests.set(fullRequest.requestId, fullRequest);
    this.emit('gdpr-request', fullRequest);

    // Log to audit trail
    await this.logGDPRAudit('request_submitted', fullRequest);

    logger.info('GDPR deletion request submitted', {
      requestId: fullRequest.requestId,
      type: fullRequest.type,
    });

    // Process immediately
    this.processGDPRRequest(fullRequest.requestId).catch((err) => {
      this.emit('error', err as Error, 'gdpr-processing');
    });

    return fullRequest.requestId;
  }

  /**
   * Process a GDPR deletion request
   */
  private async processGDPRRequest(requestId: string): Promise<void> {
    const request = this.pendingGDPRRequests.get(requestId);
    if (!request) {
      throw new Error(`GDPR request ${requestId} not found`);
    }

    request.status = 'processing';
    await this.logGDPRAudit('processing_started', request);

    try {
      let deletedCount = 0;
      const deletedIds: string[] = [];

      switch (request.type) {
        case 'specific':
          if (request.memoryIds) {
            for (const id of request.memoryIds) {
              await this.deleteMemory(id, 'GDPR', true);
              deletedIds.push(id);
              deletedCount++;
            }
          }
          break;

        case 'all':
          // Delete all memories
          if (this.memoryManager) {
            await this.memoryManager.clear();
          }
          if (request.includeVectorStore && this.vectorStore) {
            await this.vectorStore.clear();
          }
          if (request.includeConversations && this.memoryManager) {
            // Conversations are cleared with memory manager
            deletedCount = -1; // Indicate all deleted
          }
          break;

        case 'date_range':
          if (request.dateRange && this.memoryManager) {
            const entries = this.memoryManager.searchEntries({});
            for (const entry of entries) {
              if (
                entry.createdAt >= request.dateRange.start &&
                entry.createdAt <= request.dateRange.end
              ) {
                await this.deleteMemory(entry.id, 'GDPR', true);
                deletedIds.push(entry.id);
                deletedCount++;
              }
            }
          }
          break;

        case 'category':
          if (request.categories && this.memoryManager) {
            const scorer = getImportanceScorer();
            const entries = this.memoryManager.searchEntries({});
            for (const entry of entries) {
              const scored = scorer.scoreMemory(entry);
              if (request.categories.includes(scored.category)) {
                await this.deleteMemory(entry.id, 'GDPR', true);
                deletedIds.push(entry.id);
                deletedCount++;
              }
            }
          }
          break;
      }

      // Generate certificate hash
      const certificateData = JSON.stringify({
        requestId,
        deletedIds,
        timestamp: Date.now(),
        type: request.type,
      });
      const certificateHash = this.generateHash(certificateData);

      // Update request status
      request.status = 'completed';
      request.completedAt = Date.now();
      request.deletedCount = deletedCount;
      request.certificateHash = certificateHash;

      await this.logGDPRAudit('completed', request);
      this.emit('gdpr-completed', request);

      logger.info('GDPR deletion request completed', {
        requestId,
        deletedCount,
        certificateHash,
      });
    } catch (error) {
      request.status = 'failed';
      request.error = (error as Error).message;
      await this.logGDPRAudit('failed', request);
      throw error;
    }
  }

  /**
   * Get GDPR request status
   */
  getGDPRRequestStatus(requestId: string): GDPRDeletionRequest | undefined {
    return this.pendingGDPRRequests.get(requestId);
  }

  /**
   * Export GDPR audit log
   */
  async exportGDPRAuditLog(): Promise<string> {
    if (!this.config.enableGDPRAudit) {
      return '';
    }

    try {
      const content = await fs.promises.readFile(this.config.gdprAuditPath, 'utf-8');
      return content;
    } catch {
      return '';
    }
  }

  /**
   * Log GDPR audit entry
   */
  private async logGDPRAudit(
    action: string,
    request: GDPRDeletionRequest
  ): Promise<void> {
    if (!this.config.enableGDPRAudit) return;

    const entry = {
      timestamp: new Date().toISOString(),
      action,
      requestId: request.requestId,
      type: request.type,
      status: request.status,
      deletedCount: request.deletedCount,
      certificateHash: request.certificateHash,
    };

    const line = JSON.stringify(entry) + '\n';

    await fs.promises.appendFile(this.config.gdprAuditPath, line);
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Delete a memory from all stores
   */
  private async deleteMemory(
    memoryId: string,
    reason: string,
    permanent: boolean = false
  ): Promise<void> {
    // Remove from memory manager
    if (this.memoryManager) {
      this.memoryManager.removeEntry(memoryId);
    }

    // Remove from vector store
    if (this.vectorStore && this.vectorStore.isReady()) {
      await this.vectorStore.delete(memoryId);
    }

    // Remove from access history
    this.accessHistory.delete(memoryId);

    // Remove from importance scorer
    const scorer = getImportanceScorer();
    scorer.removeMemory(memoryId);

    logger.debug('Memory deleted', { memoryId, reason, permanent });
  }

  /**
   * Reset idle timer
   */
  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    if (this.config.enableIdleProcessing) {
      this.idleTimer = setTimeout(() => {
        this.emit('idle-processing');
        this.processDecay('idle').catch((err) => {
          this.emit('error', err as Error, 'idle-processing');
        });
      }, this.config.idleThresholdMs);
    }
  }

  /**
   * Generate hash for certificate
   */
  private generateHash(data: string): string {
    // Simple hash for demonstration - in production use crypto
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * Create empty result
   */
  private createEmptyResult(): ForgettingBatchResult {
    return {
      processed: 0,
      decayed: 0,
      deleted: 0,
      consolidated: 0,
      protected: 0,
      durationMs: 0,
      results: [],
      errors: [],
    };
  }

  /**
   * Get statistics
   */
  getStats(): {
    accessHistorySize: number;
    pendingGDPRRequests: number;
    isProcessing: boolean;
    lastActivityAge: number;
  } {
    return {
      accessHistorySize: this.accessHistory.size,
      pendingGDPRRequests: this.pendingGDPRRequests.size,
      isProcessing: this.isProcessing,
      lastActivityAge: Date.now() - this.lastActivityTime,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ForgettingConfig>): void {
    const wasRunning = !!this.decayTimer;
    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...config };
    logger.info('ForgettingManager config updated', { config: this.config });

    if (wasRunning) {
      this.start();
    }
  }

  /**
   * Add custom retention policy
   */
  addRetentionPolicy(policy: RetentionPolicy): void {
    // Insert before the default catch-all policy
    this.config.defaultPolicies.splice(this.config.defaultPolicies.length - 1, 0, policy);
    logger.info('Custom retention policy added', { level: policy.level });
  }

  /**
   * Shutdown the manager
   */
  async shutdown(): Promise<void> {
    this.stop();
    this.removeAllListeners();
    this.accessHistory.clear();
    this.pendingGDPRRequests.clear();
    logger.info('ForgettingManager shutdown');
  }

  // Type-safe event emitter methods
  on<K extends keyof ForgettingEvents>(event: K, listener: ForgettingEvents[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof ForgettingEvents>(event: K, listener: ForgettingEvents[K]): this {
    return super.off(event, listener);
  }

  emit<K extends keyof ForgettingEvents>(
    event: K,
    ...args: Parameters<ForgettingEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let forgettingManager: ForgettingManager | null = null;

/**
 * Get or create the forgetting manager instance
 */
export async function getForgettingManager(
  config?: Partial<ForgettingConfig>
): Promise<ForgettingManager> {
  if (!forgettingManager) {
    forgettingManager = new ForgettingManager(config);
    await forgettingManager.initialize();
  }
  return forgettingManager;
}

/**
 * Start the forgetting manager
 */
export async function startForgettingManager(
  config?: Partial<ForgettingConfig>
): Promise<void> {
  const manager = await getForgettingManager(config);
  manager.start();
}

/**
 * Stop the forgetting manager
 */
export function stopForgettingManager(): void {
  if (forgettingManager) {
    forgettingManager.stop();
  }
}

/**
 * Shutdown and cleanup
 */
export async function shutdownForgettingManager(): Promise<void> {
  if (forgettingManager) {
    await forgettingManager.shutdown();
    forgettingManager = null;
  }
}

export default ForgettingManager;
