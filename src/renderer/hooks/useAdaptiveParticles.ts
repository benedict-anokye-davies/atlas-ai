/**
 * Nova Desktop - Adaptive Particles Hook
 * Auto-adjusts particle count based on FPS to maintain smooth performance
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { usePerformanceMonitor, getPerformanceRating } from './usePerformanceMonitor';

export interface AdaptiveParticlesOptions {
  /** Target FPS to maintain (default: 55) */
  targetFps?: number;
  /** Minimum particle count (default: 2000) */
  minParticles?: number;
  /** Maximum particle count (default: 20000) */
  maxParticles?: number;
  /** Initial particle count (default: 8000) */
  initialParticles?: number;
  /** Enable adaptive behavior (default: true) */
  enabled?: boolean;
  /** Cooldown frames between adjustments (default: 60 = ~1 second) */
  adjustmentCooldown?: number;
  /** Amount to increase when FPS is good (default: 500) */
  increaseStep?: number;
  /** Amount to decrease when FPS is low (default: 1000) */
  decreaseStep?: number;
}

export interface AdaptiveParticlesResult {
  /** Current particle count */
  particleCount: number;
  /** Whether currently adjusting */
  isAdjusting: boolean;
  /** Current performance rating */
  rating: 'excellent' | 'good' | 'fair' | 'poor';
  /** Manual override to set particle count */
  setParticleCount: (count: number) => void;
  /** Reset to initial count */
  reset: () => void;
}

/**
 * Hook for adaptive particle count based on performance
 * Automatically scales particles up/down to maintain target FPS
 */
export function useAdaptiveParticles(
  options: AdaptiveParticlesOptions = {}
): AdaptiveParticlesResult {
  const {
    targetFps = 55,
    minParticles = 2000,
    maxParticles = 20000,
    initialParticles = 8000,
    enabled = true,
    adjustmentCooldown = 60,
    increaseStep = 500,
    decreaseStep = 1000,
  } = options;

  const [particleCount, setParticleCount] = useState(initialParticles);
  const [isAdjusting, setIsAdjusting] = useState(false);

  const cooldownRef = useRef(0);
  const stableFramesRef = useRef(0);
  const lastAdjustmentRef = useRef<'increase' | 'decrease' | null>(null);

  // Get current performance metrics
  const metrics = usePerformanceMonitor({ enabled });
  const rating = getPerformanceRating(metrics.avgFps);

  // Adjust particles based on FPS
  useEffect(() => {
    if (!enabled) return;

    // Decrement cooldown
    if (cooldownRef.current > 0) {
      cooldownRef.current--;
      return;
    }

    const fps = metrics.avgFps;

    // Check if we need to adjust
    if (fps < targetFps - 10) {
      // FPS too low - reduce particles
      setIsAdjusting(true);
      setParticleCount((prev) => {
        const newCount = Math.max(minParticles, prev - decreaseStep);
        if (newCount !== prev) {
          console.log(`[AdaptiveParticles] FPS low (${fps}), reducing: ${prev} → ${newCount}`);
          lastAdjustmentRef.current = 'decrease';
          cooldownRef.current = adjustmentCooldown;
          stableFramesRef.current = 0;
        }
        return newCount;
      });
      setTimeout(() => setIsAdjusting(false), 100);
    } else if (fps >= targetFps && fps >= 58) {
      // FPS is good - can we increase?
      stableFramesRef.current++;

      // Only increase after sustained good performance (2 seconds of stable FPS)
      if (stableFramesRef.current >= 120 && particleCount < maxParticles) {
        setIsAdjusting(true);
        setParticleCount((prev) => {
          const newCount = Math.min(maxParticles, prev + increaseStep);
          if (newCount !== prev) {
            console.log(
              `[AdaptiveParticles] FPS stable (${fps}), increasing: ${prev} → ${newCount}`
            );
            lastAdjustmentRef.current = 'increase';
            cooldownRef.current = adjustmentCooldown * 2; // Longer cooldown for increases
            stableFramesRef.current = 0;
          }
          return newCount;
        });
        setTimeout(() => setIsAdjusting(false), 100);
      }
    } else {
      // FPS is acceptable, reset stable counter if we were decreasing
      if (lastAdjustmentRef.current === 'decrease') {
        stableFramesRef.current = 0;
      }
    }
  }, [
    enabled,
    metrics.avgFps,
    targetFps,
    minParticles,
    maxParticles,
    particleCount,
    adjustmentCooldown,
    increaseStep,
    decreaseStep,
  ]);

  // Manual set (disables auto-adjustment temporarily)
  const handleSetParticleCount = useCallback(
    (count: number) => {
      const clampedCount = Math.max(minParticles, Math.min(maxParticles, count));
      setParticleCount(clampedCount);
      cooldownRef.current = adjustmentCooldown * 3; // Long cooldown after manual set
      stableFramesRef.current = 0;
    },
    [minParticles, maxParticles, adjustmentCooldown]
  );

  // Reset to initial
  const reset = useCallback(() => {
    setParticleCount(initialParticles);
    cooldownRef.current = 0;
    stableFramesRef.current = 0;
    lastAdjustmentRef.current = null;
  }, [initialParticles]);

  return {
    particleCount,
    isAdjusting,
    rating,
    setParticleCount: handleSetParticleCount,
    reset,
  };
}

export default useAdaptiveParticles;
