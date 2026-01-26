/**
 * Behavioral Model
 * Learns and models user behavior patterns
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../../utils/logger';
import { Entity, EntityType } from '../types';
import { getOntologyStore } from '../ontology';
import { getTemporalEngine } from '../temporal';
import {
  BehavioralModel,
  BehavioralFeature,
  BehavioralPrediction,
  LearningEvent,
  DynamicLayerConfig,
  DEFAULT_DYNAMIC_CONFIG,
} from './types';

const logger = createModuleLogger('BehavioralModeler');

// ============================================================================
// BEHAVIORAL MODELER
// ============================================================================

export class BehavioralModeler extends EventEmitter {
  private config: DynamicLayerConfig;
  private models: Map<string, BehavioralModel> = new Map();
  private learningEvents: LearningEvent[] = [];

  constructor(config: Partial<DynamicLayerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_DYNAMIC_CONFIG, ...config };
    this.initializeDefaultModels();
  }

  // --------------------------------------------------------------------------
  // INITIALIZATION
  // --------------------------------------------------------------------------

  private initializeDefaultModels(): void {
    // Preference Model - tracks user preferences
    this.models.set('preference', {
      id: 'preference',
      name: 'User Preferences',
      description: 'Models user preferences and choices',
      modelType: 'preference',
      lastUpdated: new Date(),
      trainingDataPoints: 0,
      features: [
        {
          name: 'preferred_work_hours',
          type: 'temporal',
          importance: 0.8,
          currentValue: { start: 9, end: 17 },
          historicalValues: [],
        },
        {
          name: 'communication_channel',
          type: 'categorical',
          importance: 0.6,
          currentValue: 'email',
          historicalValues: [],
        },
        {
          name: 'response_speed',
          type: 'numeric',
          importance: 0.5,
          currentValue: 30, // minutes
          historicalValues: [],
        },
      ],
      predictions: [],
    });

    // Habit Model - tracks daily habits
    this.models.set('habit', {
      id: 'habit',
      name: 'Daily Habits',
      description: 'Models daily routines and habits',
      modelType: 'habit',
      lastUpdated: new Date(),
      trainingDataPoints: 0,
      features: [
        {
          name: 'morning_routine_start',
          type: 'temporal',
          importance: 0.7,
          currentValue: 8,
          historicalValues: [],
        },
        {
          name: 'break_frequency',
          type: 'numeric',
          importance: 0.5,
          currentValue: 90, // minutes
          historicalValues: [],
        },
        {
          name: 'end_of_day',
          type: 'temporal',
          importance: 0.7,
          currentValue: 18,
          historicalValues: [],
        },
      ],
      predictions: [],
    });

    // Productivity Model - tracks productivity patterns
    this.models.set('productivity', {
      id: 'productivity',
      name: 'Productivity Patterns',
      description: 'Models productivity levels throughout the day',
      modelType: 'productivity',
      lastUpdated: new Date(),
      trainingDataPoints: 0,
      features: [
        {
          name: 'peak_hours',
          type: 'temporal',
          importance: 0.9,
          currentValue: [10, 11, 14, 15],
          historicalValues: [],
        },
        {
          name: 'focus_duration',
          type: 'numeric',
          importance: 0.8,
          currentValue: 45, // minutes
          historicalValues: [],
        },
        {
          name: 'context_switch_cost',
          type: 'numeric',
          importance: 0.7,
          currentValue: 15, // minutes to regain focus
          historicalValues: [],
        },
      ],
      predictions: [],
    });

    // Social Model - tracks social interaction patterns
    this.models.set('social', {
      id: 'social',
      name: 'Social Patterns',
      description: 'Models social interaction preferences',
      modelType: 'social',
      lastUpdated: new Date(),
      trainingDataPoints: 0,
      features: [
        {
          name: 'meeting_preference',
          type: 'categorical',
          importance: 0.6,
          currentValue: 'small_groups',
          historicalValues: [],
        },
        {
          name: 'response_priority',
          type: 'categorical',
          importance: 0.7,
          currentValue: ['manager', 'team', 'external'],
          historicalValues: [],
        },
        {
          name: 'interaction_frequency',
          type: 'numeric',
          importance: 0.5,
          currentValue: 10, // interactions per day
          historicalValues: [],
        },
      ],
      predictions: [],
    });
  }

  // --------------------------------------------------------------------------
  // LEARNING
  // --------------------------------------------------------------------------

  recordEvent(event: Omit<LearningEvent, 'id'>): void {
    const fullEvent: LearningEvent = {
      ...event,
      id: this.generateId(),
    };

    this.learningEvents.push(fullEvent);

    // Trim old events
    const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
    this.learningEvents = this.learningEvents.filter(e => e.timestamp.getTime() > cutoff);

    // Update models based on event
    this.updateModels(fullEvent);

    // Batch retraining
    if (this.learningEvents.length % this.config.batchSize === 0) {
      this.retrainModels();
    }
  }

  private updateModels(event: LearningEvent): void {
    const now = event.timestamp;
    const hour = now.getHours();

    // Update habit model
    const habitModel = this.models.get('habit');
    if (habitModel && event.action) {
      // Update morning routine if early activity
      if (hour >= 6 && hour <= 10) {
        const feature = habitModel.features.find(f => f.name === 'morning_routine_start');
        if (feature) {
          feature.historicalValues.push({ value: hour, timestamp: now });
          feature.currentValue = this.calculateMovingAverage(feature.historicalValues, 'value');
        }
      }

      // Update end of day if late activity
      if (hour >= 17 && hour <= 23) {
        const feature = habitModel.features.find(f => f.name === 'end_of_day');
        if (feature) {
          feature.historicalValues.push({ value: hour, timestamp: now });
          feature.currentValue = this.calculateMovingAverage(feature.historicalValues, 'value');
        }
      }

      habitModel.lastUpdated = now;
      habitModel.trainingDataPoints++;
    }

    // Update productivity model
    const prodModel = this.models.get('productivity');
    if (prodModel && event.outcome === 'positive') {
      const feature = prodModel.features.find(f => f.name === 'peak_hours');
      if (feature) {
        feature.historicalValues.push({ value: hour, timestamp: now });
        // Update peak hours - find most frequent hours
        const hourCounts = new Map<number, number>();
        for (const val of feature.historicalValues.slice(-100)) {
          const h = val.value as number;
          hourCounts.set(h, (hourCounts.get(h) ?? 0) + 1);
        }
        const sortedHours = [...hourCounts.entries()].sort((a, b) => b[1] - a[1]);
        feature.currentValue = sortedHours.slice(0, 4).map(([h]) => h);
      }

      prodModel.lastUpdated = now;
      prodModel.trainingDataPoints++;
    }

    // Update social model
    const socialModel = this.models.get('social');
    if (socialModel && event.entityType === 'person') {
      const feature = socialModel.features.find(f => f.name === 'interaction_frequency');
      if (feature) {
        // Count unique interaction days
        const today = now.toDateString();
        const recentDays = new Set(
          feature.historicalValues
            .filter(v => v.timestamp.getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000)
            .map(v => v.timestamp.toDateString())
        );
        recentDays.add(today);

        feature.historicalValues.push({ value: 1, timestamp: now });
        feature.currentValue = feature.historicalValues
          .filter(v => v.timestamp.getTime() > Date.now() - 24 * 60 * 60 * 1000)
          .length;
      }

      socialModel.lastUpdated = now;
      socialModel.trainingDataPoints++;
    }
  }

  private retrainModels(): void {
    logger.debug('Retraining behavioral models...');

    for (const [modelId, model] of this.models) {
      // Generate predictions for each model
      model.predictions = this.generateModelPredictions(model);
      model.lastUpdated = new Date();

      this.emit('model-updated', model);
    }
  }

  private generateModelPredictions(model: BehavioralModel): BehavioralPrediction[] {
    const predictions: BehavioralPrediction[] = [];
    const now = new Date();
    const validUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    for (const feature of model.features) {
      if (feature.historicalValues.length >= 5) {
        // Predict next value
        const trend = this.calculateTrend(feature.historicalValues);
        let predictedValue: unknown;

        if (feature.type === 'numeric') {
          const current = feature.currentValue as number;
          predictedValue = current + trend * this.config.learningRate;
        } else {
          predictedValue = feature.currentValue;
        }

        predictions.push({
          feature: feature.name,
          predictedValue,
          confidence: Math.min(0.9, feature.historicalValues.length / 50),
          validUntil,
        });
      }
    }

    return predictions;
  }

  // --------------------------------------------------------------------------
  // MODEL ACCESS
  // --------------------------------------------------------------------------

  getModel(modelId: string): BehavioralModel | undefined {
    return this.models.get(modelId);
  }

  getAllModels(): BehavioralModel[] {
    return [...this.models.values()];
  }

  getFeatureValue(modelId: string, featureName: string): unknown | undefined {
    const model = this.models.get(modelId);
    if (!model) return undefined;

    const feature = model.features.find(f => f.name === featureName);
    return feature?.currentValue;
  }

  getPrediction(modelId: string, featureName: string): BehavioralPrediction | undefined {
    const model = this.models.get(modelId);
    if (!model) return undefined;

    return model.predictions.find(p => p.feature === featureName);
  }

  // --------------------------------------------------------------------------
  // INSIGHTS
  // --------------------------------------------------------------------------

  async getInsights(): Promise<Array<{
    type: 'habit' | 'productivity' | 'social';
    insight: string;
    confidence: number;
  }>> {
    const insights: Array<{
      type: 'habit' | 'productivity' | 'social';
      insight: string;
      confidence: number;
    }> = [];

    // Habit insights
    const habitModel = this.models.get('habit');
    if (habitModel && habitModel.trainingDataPoints > 10) {
      const morningStart = habitModel.features.find(f => f.name === 'morning_routine_start');
      const endOfDay = habitModel.features.find(f => f.name === 'end_of_day');

      if (morningStart && endOfDay) {
        const workHours = (endOfDay.currentValue as number) - (morningStart.currentValue as number);
        insights.push({
          type: 'habit',
          insight: `Your typical work day spans ${workHours.toFixed(1)} hours (${morningStart.currentValue}:00 to ${endOfDay.currentValue}:00)`,
          confidence: Math.min(0.85, habitModel.trainingDataPoints / 50),
        });
      }
    }

    // Productivity insights
    const prodModel = this.models.get('productivity');
    if (prodModel && prodModel.trainingDataPoints > 10) {
      const peakHours = prodModel.features.find(f => f.name === 'peak_hours');
      const focusDuration = prodModel.features.find(f => f.name === 'focus_duration');

      if (peakHours && Array.isArray(peakHours.currentValue)) {
        const hours = peakHours.currentValue as number[];
        insights.push({
          type: 'productivity',
          insight: `Your peak productive hours are around ${hours.join(', ')}:00`,
          confidence: Math.min(0.8, prodModel.trainingDataPoints / 50),
        });
      }

      if (focusDuration) {
        insights.push({
          type: 'productivity',
          insight: `Your optimal focus sessions last about ${(focusDuration.currentValue as number).toFixed(0)} minutes`,
          confidence: Math.min(0.75, prodModel.trainingDataPoints / 50),
        });
      }
    }

    // Social insights
    const socialModel = this.models.get('social');
    if (socialModel && socialModel.trainingDataPoints > 10) {
      const interactionFreq = socialModel.features.find(f => f.name === 'interaction_frequency');

      if (interactionFreq) {
        insights.push({
          type: 'social',
          insight: `You average ${(interactionFreq.currentValue as number).toFixed(0)} interactions per day`,
          confidence: Math.min(0.7, socialModel.trainingDataPoints / 50),
        });
      }
    }

    return insights.sort((a, b) => b.confidence - a.confidence);
  }

  // --------------------------------------------------------------------------
  // UTILITY METHODS
  // --------------------------------------------------------------------------

  private generateId(): string {
    return `bm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private calculateMovingAverage(
    values: Array<{ value: unknown; timestamp: Date }>,
    key: string,
    window: number = 10
  ): number {
    const recentValues = values.slice(-window);
    if (recentValues.length === 0) return 0;

    const sum = recentValues.reduce((acc, v) => {
      const val = typeof v.value === 'number' ? v.value : 0;
      return acc + val;
    }, 0);

    return sum / recentValues.length;
  }

  private calculateTrend(values: Array<{ value: unknown; timestamp: Date }>): number {
    if (values.length < 2) return 0;

    const numericValues = values
      .filter(v => typeof v.value === 'number')
      .slice(-20);

    if (numericValues.length < 2) return 0;

    // Simple linear regression
    const n = numericValues.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

    for (let i = 0; i < n; i++) {
      const x = i;
      const y = numericValues[i]!.value as number;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    return isNaN(slope) ? 0 : slope;
  }

  // --------------------------------------------------------------------------
  // STATISTICS
  // --------------------------------------------------------------------------

  getStats(): {
    totalModels: number;
    totalDataPoints: number;
    modelsSummary: Array<{ id: string; dataPoints: number; lastUpdated: Date }>;
  } {
    const modelsSummary = [...this.models.values()].map(m => ({
      id: m.id,
      dataPoints: m.trainingDataPoints,
      lastUpdated: m.lastUpdated,
    }));

    return {
      totalModels: this.models.size,
      totalDataPoints: this.learningEvents.length,
      modelsSummary,
    };
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: BehavioralModeler | null = null;

export function getBehavioralModeler(): BehavioralModeler {
  if (!instance) {
    instance = new BehavioralModeler();
  }
  return instance;
}
