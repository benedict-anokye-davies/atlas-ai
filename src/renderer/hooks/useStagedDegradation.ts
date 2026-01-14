/**
 * Staged Degradation Hook
 *
 * Automatically adapts orb rendering quality based on FPS performance.
 * Implements a 4-stage degradation system to maintain smooth visuals.
 *
 * Stages:
 * 1. FPS < 55 for 2s → reduce particles by 25%
 * 2. FPS < 45 for 2s → reduce particles by 50%
 * 3. FPS < 30 for 2s → simplify attractor math
 * 4. FPS < 20 for 2s → reduce to minimum particles
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePerformanceMonitor } from './usePerformanceMonitor';
import { REDUCTION_LEVELS } from './useAdaptiveParticles';
import type { AttractorMode } from '../components/orb/attractors';

/**
 * Degradation stage levels
 */
export type DegradationStage = 0 | 1 | 2 | 3 | 4;

/**
 * Stage configuration
 */
export interface StageConfig {
  stage: DegradationStage;
  fpsThreshold: number;
  particleReduction: number; // Percentage from original
  attractorMode: AttractorMode;
  description: string;
}

/**
 * Default stage configurations
 */
export const DEFAULT_STAGES: StageConfig[] = [
  {
    stage: 0,
    fpsThreshold: 55,
    particleReduction: 0,
    attractorMode: 'optimized',
    description: 'Full quality',
  },
  {
    stage: 1,
    fpsThreshold: 55,
    particleReduction: REDUCTION_LEVELS.STAGE_1, // 25%
    attractorMode: 'optimized',
    description: 'Reduced particles (25%)',
  },
  {
    stage: 2,
    fpsThreshold: 45,
    particleReduction: REDUCTION_LEVELS.STAGE_2, // 50%
    attractorMode: 'optimized',
    description: 'Reduced particles (50%)',
  },
  {
    stage: 3,
    fpsThreshold: 30,
    particleReduction: REDUCTION_LEVELS.STAGE_2, // Keep 50%
    attractorMode: 'simplified',
    description: 'Simplified attractor',
  },
  {
    stage: 4,
    fpsThreshold: 20,
    particleReduction: REDUCTION_LEVELS.STAGE_3, // 75%
    attractorMode: 'simplified',
    description: 'Minimum particles',
  },
];

/**
 * Staged degradation result
 */
export interface StagedDegradationResult {
  /** Current degradation stage (0 = no degradation) */
  currentStage: DegradationStage;
  /** Configuration for current stage */
  stageConfig: StageConfig;
  /** Particle count after degradation */
  particleCount: number;
  /** Attractor mode to use */
  attractorMode: AttractorMode;
  /** Whether degradation is in transition */
  isTransitioning: boolean;
  /** Current FPS */
  currentFps: number;
  /** Time until next stage change (if degrading) */
  timeToChange: number;
  /** Force a specific stage (for testing) */
  forceStage: (stage: DegradationStage) => void;
  /** Reset to stage 0 */
  reset: () => void;
}

/**
 * Hook options
 */
export interface StagedDegradationOptions {
  /** Initial particle count (default: 8000) */
  initialParticles?: number;
  /** Minimum particle count (default: 2000) */
  minParticles?: number;
  /** Duration in ms that FPS must be below threshold (default: 2000) */
  degradeThreshold?: number;
  /** Duration in ms that FPS must be above threshold to upgrade (default: 5000) */
  upgradeThreshold?: number;
  /** Enable automatic degradation (default: true) */
  enabled?: boolean;
  /** Custom stage configurations */
  stages?: StageConfig[];
  /** Callback when stage changes */
  onStageChange?: (oldStage: DegradationStage, newStage: DegradationStage) => void;
}

/**
 * Staged degradation hook
 */
export function useStagedDegradation(
  options: StagedDegradationOptions = {}
): StagedDegradationResult {
  const {
    initialParticles = 8000,
    minParticles = 2000,
    degradeThreshold = 2000,
    upgradeThreshold = 5000,
    enabled = true,
    stages = DEFAULT_STAGES,
    onStageChange,
  } = options;

  const [currentStage, setCurrentStage] = useState<DegradationStage>(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [timeToChange, setTimeToChange] = useState(0);

  const degradeStartTimeRef = useRef<number | null>(null);
  const upgradeStartTimeRef = useRef<number | null>(null);
  const lastStageChangeRef = useRef(Date.now());

  // Get performance metrics
  const metrics = usePerformanceMonitor({ enabled });

  // Calculate particle count based on stage
  const calculateParticleCount = useCallback(
    (stage: DegradationStage): number => {
      const config = stages[stage];
      if (!config) return initialParticles;

      const reduction = config.particleReduction / 100;
      const reduced = Math.round(initialParticles * (1 - reduction));
      return Math.max(minParticles, reduced);
    },
    [initialParticles, minParticles, stages]
  );

  // Get current stage config
  const stageConfig = stages[currentStage] || stages[0];

  // Calculate current particle count
  const particleCount = calculateParticleCount(currentStage);

  // Get attractor mode for current stage
  const attractorMode = stageConfig.attractorMode;

  // Check if we should degrade
  const shouldDegrade = useCallback(
    (fps: number, stage: DegradationStage): boolean => {
      if (stage >= 4) return false; // Already at max degradation

      const nextStage = stages[stage + 1];
      if (!nextStage) return false;

      return fps < nextStage.fpsThreshold;
    },
    [stages]
  );

  // Check if we should upgrade
  const shouldUpgrade = useCallback(
    (fps: number, stage: DegradationStage): boolean => {
      if (stage <= 0) return false; // Already at no degradation

      const currentConfig = stages[stage];
      if (!currentConfig) return false;

      // Must be above current threshold by a margin
      return fps >= currentConfig.fpsThreshold + 5;
    },
    [stages]
  );

  // Degradation/upgrade logic
  useEffect(() => {
    if (!enabled) return;

    const fps = metrics.avgFps;
    const now = Date.now();

    // Check for degradation
    if (shouldDegrade(fps, currentStage)) {
      if (!degradeStartTimeRef.current) {
        degradeStartTimeRef.current = now;
      }

      const elapsed = now - degradeStartTimeRef.current;
      setTimeToChange(Math.max(0, degradeThreshold - elapsed));

      if (elapsed >= degradeThreshold) {
        // Time to degrade
        const newStage = Math.min(4, currentStage + 1) as DegradationStage;
        const oldStage = currentStage;

        setIsTransitioning(true);
        setCurrentStage(newStage);
        degradeStartTimeRef.current = null;
        upgradeStartTimeRef.current = null;
        lastStageChangeRef.current = now;

        setTimeout(() => setIsTransitioning(false), 500);

        if (onStageChange) {
          onStageChange(oldStage, newStage);
        }
      }
    } else {
      degradeStartTimeRef.current = null;

      // Check for upgrade
      if (shouldUpgrade(fps, currentStage)) {
        if (!upgradeStartTimeRef.current) {
          upgradeStartTimeRef.current = now;
        }

        const elapsed = now - upgradeStartTimeRef.current;
        setTimeToChange(Math.max(0, upgradeThreshold - elapsed));

        if (elapsed >= upgradeThreshold) {
          // Time to upgrade
          const newStage = Math.max(0, currentStage - 1) as DegradationStage;
          const oldStage = currentStage;

          setIsTransitioning(true);
          setCurrentStage(newStage);
          upgradeStartTimeRef.current = null;
          lastStageChangeRef.current = now;

          setTimeout(() => setIsTransitioning(false), 500);

          if (onStageChange) {
            onStageChange(oldStage, newStage);
          }
        }
      } else {
        upgradeStartTimeRef.current = null;
        setTimeToChange(0);
      }
    }
  }, [
    enabled,
    metrics.avgFps,
    currentStage,
    degradeThreshold,
    upgradeThreshold,
    shouldDegrade,
    shouldUpgrade,
    onStageChange,
  ]);

  // Force a specific stage
  const forceStage = useCallback((stage: DegradationStage) => {
    setCurrentStage(stage);
    setIsTransitioning(true);
    setTimeout(() => setIsTransitioning(false), 500);
    degradeStartTimeRef.current = null;
    upgradeStartTimeRef.current = null;
    // Intentionally not calling onStageChange for forced changes
  }, []);

  // Reset to stage 0
  const reset = useCallback(() => {
    setCurrentStage(0);
    setIsTransitioning(true);
    setTimeout(() => setIsTransitioning(false), 500);
    degradeStartTimeRef.current = null;
    upgradeStartTimeRef.current = null;
  }, []);

  return {
    currentStage,
    stageConfig,
    particleCount,
    attractorMode,
    isTransitioning,
    currentFps: metrics.avgFps,
    timeToChange,
    forceStage,
    reset,
  };
}

/**
 * Get stage description for UI display
 */
export function getStageDescription(stage: DegradationStage): string {
  return DEFAULT_STAGES[stage]?.description || 'Unknown stage';
}

/**
 * Check if a stage is degraded (not at full quality)
 */
export function isDegraded(stage: DegradationStage): boolean {
  return stage > 0;
}

/**
 * Get severity level for UI indicators
 */
export function getStageSeverity(
  stage: DegradationStage
): 'none' | 'low' | 'medium' | 'high' {
  switch (stage) {
    case 0:
      return 'none';
    case 1:
      return 'low';
    case 2:
      return 'medium';
    case 3:
    case 4:
      return 'high';
  }
}

export default useStagedDegradation;
