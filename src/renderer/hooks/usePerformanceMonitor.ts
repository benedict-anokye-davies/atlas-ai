/**
 * Nova Desktop - Performance Monitor Hook
 * Real-time FPS and memory usage tracking for adaptive quality
 */

import { useEffect, useRef, useState, useCallback } from 'react';

export interface PerformanceMetrics {
  fps: number;
  avgFps: number;
  memoryUsage: number; // MB
  frameTime: number; // ms
  gpuTime?: number; // ms (if available)
}

interface UsePerformanceMonitorOptions {
  /** Enable/disable monitoring (default: true) */
  enabled?: boolean;
  /** Sample interval in ms (default: 1000) */
  sampleInterval?: number;
  /** Number of samples for averaging (default: 10) */
  averageSamples?: number;
}

/**
 * Hook for real-time performance monitoring
 * Tracks FPS, memory usage, and frame timing
 */
export function usePerformanceMonitor(options: UsePerformanceMonitorOptions = {}) {
  const { enabled = true, sampleInterval = 1000, averageSamples = 10 } = options;

  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    fps: 60,
    avgFps: 60,
    memoryUsage: 0,
    frameTime: 16.67,
  });

  // Refs for tracking
  const frameCountRef = useRef(0);
  const fpsHistoryRef = useRef<number[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef(performance.now());

  // Calculate average FPS
  const calculateAvgFps = useCallback(
    (currentFps: number): number => {
      const history = fpsHistoryRef.current;
      history.push(currentFps);

      // Keep only the last N samples
      if (history.length > averageSamples) {
        history.shift();
      }

      // Calculate average
      const sum = history.reduce((a, b) => a + b, 0);
      return Math.round(sum / history.length);
    },
    [averageSamples]
  );

  // Get memory usage (Chrome only)
  const getMemoryUsage = useCallback((): number => {
    // @ts-expect-error - performance.memory is Chrome-only
    if (performance.memory) {
      // @ts-expect-error - performance.memory is Chrome-only
      return Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
    }
    return 0;
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let lastSampleTime = performance.now();

    const measureFrame = (currentTime: number) => {
      // Calculate frame time
      const frameTime = currentTime - lastFrameTimeRef.current;
      lastFrameTimeRef.current = currentTime;

      // Count frames
      frameCountRef.current++;

      // Check if sample interval has passed
      const elapsed = currentTime - lastSampleTime;

      if (elapsed >= sampleInterval) {
        // Calculate FPS for this interval
        const fps = Math.round((frameCountRef.current * 1000) / elapsed);
        const avgFps = calculateAvgFps(fps);
        const memoryUsage = getMemoryUsage();

        setMetrics({
          fps,
          avgFps,
          memoryUsage,
          frameTime: Math.round(frameTime * 100) / 100,
        });

        // Reset for next interval
        frameCountRef.current = 0;
        lastSampleTime = currentTime;
      }

      // Continue loop
      animationFrameRef.current = requestAnimationFrame(measureFrame);
    };

    // Start measuring
    animationFrameRef.current = requestAnimationFrame(measureFrame);

    // Cleanup
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [enabled, sampleInterval, calculateAvgFps, getMemoryUsage]);

  return metrics;
}

/**
 * Get a performance rating based on FPS
 */
export function getPerformanceRating(fps: number): 'excellent' | 'good' | 'fair' | 'poor' {
  if (fps >= 55) return 'excellent';
  if (fps >= 45) return 'good';
  if (fps >= 30) return 'fair';
  return 'poor';
}

/**
 * Suggested particle count based on performance
 */
export function getSuggestedParticleCount(fps: number, currentCount: number): number {
  const rating = getPerformanceRating(fps);

  switch (rating) {
    case 'excellent':
      // Can increase if not at max
      return Math.min(15000, currentCount + 500);
    case 'good':
      // Maintain current
      return currentCount;
    case 'fair':
      // Reduce slightly
      return Math.max(3000, currentCount - 1000);
    case 'poor':
      // Reduce significantly
      return Math.max(2000, currentCount - 2000);
  }
}
