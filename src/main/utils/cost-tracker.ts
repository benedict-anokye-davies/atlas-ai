/**
 * Atlas Desktop - API Cost Tracker
 * Tracks API usage costs and enforces budget limits
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createModuleLogger } from './logger';
import { isoDate } from '../../shared/utils';

const logger = createModuleLogger('CostTracker');

/**
 * API cost rates per service
 * Rates are approximate and should be updated as pricing changes
 */
export const API_COSTS = {
  // Deepgram STT - $0.0043 per minute
  deepgram: {
    perMinute: 0.0043,
    perSecond: 0.0043 / 60,
  },
  // ElevenLabs TTS - $0.30 per 1000 characters
  elevenlabs: {
    perCharacter: 0.0003, // $0.30 / 1000
    perThousandChars: 0.3,
  },
  // Fireworks AI - GLM-4.7 Thinking premium tier (~$0.60-$2.00 per 1M tokens)
  fireworks: {
    perInputToken: 0.0000006, // $0.60 / 1M (GLM-4.7 Thinking input)
    perOutputToken: 0.000002, // $2.00 / 1M (GLM-4.7 Thinking output with reasoning)
    perThousandTokens: 0.0006,
  },
  // OpenRouter - varies by model, using average estimate
  openrouter: {
    perInputToken: 0.000001,
    perOutputToken: 0.000003,
    perThousandTokens: 0.001,
  },
  // Vosk (offline) - free
  vosk: {
    perMinute: 0,
    perSecond: 0,
  },
  // Piper (offline TTS) - free
  piper: {
    perCharacter: 0,
    perThousandChars: 0,
  },
} as const;

export type ServiceType = keyof typeof API_COSTS;

/**
 * Usage record for a single API call
 */
export interface UsageRecord {
  id: string;
  service: ServiceType;
  timestamp: number;
  units: number; // minutes for STT, chars for TTS, tokens for LLM
  cost: number;
  metadata?: Record<string, unknown>;
}

/**
 * Daily usage summary
 */
export interface DailyUsage {
  date: string; // YYYY-MM-DD
  totalCost: number;
  byService: Record<ServiceType, { units: number; cost: number }>;
  records: UsageRecord[];
}

/**
 * Cost tracker configuration
 */
export interface CostTrackerConfig {
  dailyBudget: number; // Default $5/day
  warningThreshold: number; // Warn at 80% of budget
  persistPath?: string; // Path to persist usage data
  autoSave: boolean;
  autoSaveInterval: number; // ms
}

/**
 * Cost tracker events
 */
export interface CostTrackerEvents {
  'usage-recorded': (record: UsageRecord) => void;
  'budget-warning': (usage: number, budget: number) => void;
  'budget-exceeded': (usage: number, budget: number) => void;
  'daily-reset': () => void;
}

/**
 * API Cost Tracker
 * Tracks usage costs across all API services
 */
export class CostTracker extends EventEmitter {
  private config: CostTrackerConfig;
  private dailyUsage: DailyUsage;
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private isDestroyed: boolean = false;

  constructor(config: Partial<CostTrackerConfig> = {}) {
    super();

    this.config = {
      dailyBudget: config.dailyBudget ?? 5.0,
      warningThreshold: config.warningThreshold ?? 0.8,
      persistPath: config.persistPath ?? path.join(app.getPath('userData'), 'cost-usage.json'),
      autoSave: config.autoSave ?? true,
      autoSaveInterval: config.autoSaveInterval ?? 60000, // 1 minute
    };

    this.dailyUsage = this.createEmptyDailyUsage();
    this.loadUsage();

    // Set up auto-save
    if (this.config.autoSave) {
      this.saveTimer = setInterval(() => this.saveUsage(), this.config.autoSaveInterval);
    }

    logger.info('Cost tracker initialized', {
      dailyBudget: this.config.dailyBudget,
      persistPath: this.config.persistPath,
    });
  }

  /**
   * Create empty daily usage object
   */
  private createEmptyDailyUsage(): DailyUsage {
    const today = isoDate();
    return {
      date: today,
      totalCost: 0,
      byService: {
        deepgram: { units: 0, cost: 0 },
        elevenlabs: { units: 0, cost: 0 },
        fireworks: { units: 0, cost: 0 },
        openrouter: { units: 0, cost: 0 },
        vosk: { units: 0, cost: 0 },
        piper: { units: 0, cost: 0 },
      },
      records: [],
    };
  }

  /**
   * Check if we need to reset for a new day
   */
  private checkDayReset(): void {
    const today = isoDate();
    if (this.dailyUsage.date !== today) {
      logger.info('Daily reset', { previousDate: this.dailyUsage.date, newDate: today });
      this.saveUsage(); // Save previous day
      this.dailyUsage = this.createEmptyDailyUsage();
      this.emit('daily-reset');
    }
  }

  /**
   * Record API usage
   */
  recordUsage(
    service: ServiceType,
    units: number,
    metadata?: Record<string, unknown>
  ): UsageRecord {
    this.checkDayReset();

    const cost = this.calculateCost(service, units);
    const record: UsageRecord = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      service,
      timestamp: Date.now(),
      units,
      cost,
      metadata,
    };

    // Update totals
    this.dailyUsage.totalCost += cost;
    this.dailyUsage.byService[service].units += units;
    this.dailyUsage.byService[service].cost += cost;
    this.dailyUsage.records.push(record);

    // Check budget
    const usagePercent = this.dailyUsage.totalCost / this.config.dailyBudget;
    if (usagePercent >= 1) {
      this.emit('budget-exceeded', this.dailyUsage.totalCost, this.config.dailyBudget);
      logger.warn('Budget exceeded', {
        usage: this.dailyUsage.totalCost,
        budget: this.config.dailyBudget,
      });
    } else if (usagePercent >= this.config.warningThreshold) {
      this.emit('budget-warning', this.dailyUsage.totalCost, this.config.dailyBudget);
      logger.info('Budget warning', {
        usage: this.dailyUsage.totalCost,
        budget: this.config.dailyBudget,
        percent: Math.round(usagePercent * 100),
      });
    }

    this.emit('usage-recorded', record);
    logger.debug('Usage recorded', { service, units, cost });

    return record;
  }

  /**
   * Calculate cost for usage
   */
  private calculateCost(service: ServiceType, units: number): number {
    switch (service) {
      case 'deepgram':
        return units * API_COSTS.deepgram.perSecond; // units = seconds
      case 'vosk':
        return units * API_COSTS.vosk.perSecond; // units = seconds
      case 'elevenlabs':
        return units * API_COSTS.elevenlabs.perCharacter; // units = characters
      case 'piper':
        return units * API_COSTS.piper.perCharacter; // units = characters
      case 'fireworks':
        // For LLM, units = total tokens (simplified - could split input/output)
        return units * API_COSTS.fireworks.perInputToken;
      case 'openrouter':
        return units * API_COSTS.openrouter.perInputToken;
      default:
        return 0;
    }
  }

  /**
   * Record STT usage (by seconds)
   */
  recordSTT(service: 'deepgram' | 'vosk', durationSeconds: number): UsageRecord {
    return this.recordUsage(service, durationSeconds, { type: 'stt', durationSeconds });
  }

  /**
   * Record TTS usage (by characters)
   */
  recordTTS(service: 'elevenlabs' | 'piper', characterCount: number): UsageRecord {
    return this.recordUsage(service, characterCount, { type: 'tts', characterCount });
  }

  /**
   * Record LLM usage (by tokens)
   */
  recordLLM(
    service: 'fireworks' | 'openrouter',
    inputTokens: number,
    outputTokens: number
  ): UsageRecord {
    const rates = API_COSTS[service];
    const cost = inputTokens * rates.perInputToken + outputTokens * rates.perOutputToken;
    const totalTokens = inputTokens + outputTokens;

    const record: UsageRecord = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      service,
      timestamp: Date.now(),
      units: totalTokens,
      cost,
      metadata: { type: 'llm', inputTokens, outputTokens },
    };

    this.checkDayReset();

    this.dailyUsage.totalCost += cost;
    this.dailyUsage.byService[service].units += totalTokens;
    this.dailyUsage.byService[service].cost += cost;
    this.dailyUsage.records.push(record);

    // Check budget (same as recordUsage)
    const usagePercent = this.dailyUsage.totalCost / this.config.dailyBudget;
    if (usagePercent >= 1) {
      this.emit('budget-exceeded', this.dailyUsage.totalCost, this.config.dailyBudget);
    } else if (usagePercent >= this.config.warningThreshold) {
      this.emit('budget-warning', this.dailyUsage.totalCost, this.config.dailyBudget);
    }

    this.emit('usage-recorded', record);
    logger.debug('LLM usage recorded', { service, inputTokens, outputTokens, cost });

    return record;
  }

  /**
   * Check if within budget
   */
  isWithinBudget(): boolean {
    this.checkDayReset();
    return this.dailyUsage.totalCost < this.config.dailyBudget;
  }

  /**
   * Get remaining budget
   */
  getRemainingBudget(): number {
    this.checkDayReset();
    return Math.max(0, this.config.dailyBudget - this.dailyUsage.totalCost);
  }

  /**
   * Get budget usage percentage (0-1)
   */
  getBudgetUsagePercent(): number {
    this.checkDayReset();
    return Math.min(1, this.dailyUsage.totalCost / this.config.dailyBudget);
  }

  /**
   * Get daily usage summary
   */
  getDailyUsage(): DailyUsage {
    this.checkDayReset();
    return { ...this.dailyUsage };
  }

  /**
   * Get usage stats
   */
  getStats(): {
    todaySpend: number;
    remainingBudget: number;
    usagePercent: number;
    dailyBudget: number;
    byService: Record<ServiceType, { units: number; cost: number }>;
  } {
    this.checkDayReset();
    return {
      todaySpend: this.dailyUsage.totalCost,
      remainingBudget: this.getRemainingBudget(),
      usagePercent: this.getBudgetUsagePercent(),
      dailyBudget: this.config.dailyBudget,
      byService: { ...this.dailyUsage.byService },
    };
  }

  /**
   * Set daily budget
   */
  setDailyBudget(budget: number): void {
    this.config.dailyBudget = Math.max(0, budget);
    logger.info('Daily budget updated', { budget: this.config.dailyBudget });
  }

  /**
   * Save usage to disk
   */
  saveUsage(): void {
    if (!this.config.persistPath || this.isDestroyed) return;

    try {
      const dir = path.dirname(this.config.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(
        this.config.persistPath,
        JSON.stringify(
          {
            dailyUsage: this.dailyUsage,
            config: {
              dailyBudget: this.config.dailyBudget,
              warningThreshold: this.config.warningThreshold,
            },
          },
          null,
          2
        )
      );
      // Only log if not destroyed (logger may be closed)
      if (!this.isDestroyed) {
        logger.debug('Usage saved to disk');
      }
    } catch (error) {
      // Only log if not destroyed
      if (!this.isDestroyed) {
        logger.error('Failed to save usage', { error });
      }
    }
  }

  /**
   * Load usage from disk
   */
  private loadUsage(): void {
    if (!this.config.persistPath || !fs.existsSync(this.config.persistPath)) return;

    try {
      const data = JSON.parse(fs.readFileSync(this.config.persistPath, 'utf-8'));
      const today = isoDate();

      // Only restore if same day
      if (data.dailyUsage && data.dailyUsage.date === today) {
        this.dailyUsage = data.dailyUsage;
        logger.info('Usage restored from disk', {
          totalCost: this.dailyUsage.totalCost,
          recordCount: this.dailyUsage.records.length,
        });
      }

      // Restore config
      if (data.config) {
        if (data.config.dailyBudget) {
          this.config.dailyBudget = data.config.dailyBudget;
        }
        if (data.config.warningThreshold) {
          this.config.warningThreshold = data.config.warningThreshold;
        }
      }
    } catch (error) {
      logger.error('Failed to load usage', { error });
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    // Mark as destroyed first to prevent timer callbacks from logging
    this.isDestroyed = true;

    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }

    // Save usage without logging (logger may be closed)
    if (this.config.persistPath) {
      try {
        const dir = path.dirname(this.config.persistPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(
          this.config.persistPath,
          JSON.stringify(
            {
              dailyUsage: this.dailyUsage,
              config: {
                dailyBudget: this.config.dailyBudget,
                warningThreshold: this.config.warningThreshold,
              },
            },
            null,
            2
          )
        );
      } catch {
        // Silently fail during shutdown - logger may be closed
      }
    }

    this.removeAllListeners();
  }
}

// Singleton instance
let costTrackerInstance: CostTracker | null = null;

/**
 * Get or create the cost tracker singleton
 */
export function getCostTracker(config?: Partial<CostTrackerConfig>): CostTracker {
  if (!costTrackerInstance) {
    costTrackerInstance = new CostTracker(config);
  }
  return costTrackerInstance;
}

/**
 * Destroy the cost tracker singleton
 */
export function destroyCostTracker(): void {
  if (costTrackerInstance) {
    costTrackerInstance.destroy();
    costTrackerInstance = null;
  }
}

export default CostTracker;
