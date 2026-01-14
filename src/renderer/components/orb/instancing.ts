/**
 * Instanced Rendering Utilities for Orb Particles
 *
 * Provides:
 * - Object pooling for zero-GC particle management
 * - Pre-allocated TypedArrays for position/color/size data
 * - Efficient buffer update patterns
 */

import * as THREE from 'three';

/**
 * Object pool for Float32Arrays to avoid GC pressure
 */
export class Float32ArrayPool {
  private pools: Map<number, Float32Array[]> = new Map();
  private borrowed: Map<Float32Array, number> = new Map();

  /**
   * Borrow an array of the specified size
   */
  borrow(size: number): Float32Array {
    let pool = this.pools.get(size);
    if (!pool) {
      pool = [];
      this.pools.set(size, pool);
    }

    let array = pool.pop();
    if (!array) {
      array = new Float32Array(size);
    }

    this.borrowed.set(array, size);
    return array;
  }

  /**
   * Return an array to the pool
   */
  return(array: Float32Array): void {
    const size = this.borrowed.get(array);
    if (size !== undefined) {
      // Zero out the array for reuse
      array.fill(0);
      const pool = this.pools.get(size);
      if (pool) {
        pool.push(array);
      }
      this.borrowed.delete(array);
    }
  }

  /**
   * Clear all pools
   */
  clear(): void {
    this.pools.clear();
    this.borrowed.clear();
  }

  /**
   * Get pool statistics
   */
  getStats(): { pooledCount: number; borrowedCount: number; poolSizes: number[] } {
    let pooledCount = 0;
    for (const pool of this.pools.values()) {
      pooledCount += pool.length;
    }
    return {
      pooledCount,
      borrowedCount: this.borrowed.size,
      poolSizes: Array.from(this.pools.keys()),
    };
  }
}

/**
 * Global array pool instance
 */
export const arrayPool = new Float32ArrayPool();

/**
 * Particle buffer manager for efficient GPU updates
 */
export class ParticleBufferManager {
  private geometry: THREE.BufferGeometry;
  private positionAttribute: THREE.BufferAttribute;
  private colorAttribute: THREE.BufferAttribute;
  private sizeAttribute: THREE.BufferAttribute;
  private alphaAttribute: THREE.BufferAttribute;

  private _particleCount: number;
  private _maxParticles: number;

  constructor(maxParticles: number) {
    this._maxParticles = maxParticles;
    this._particleCount = maxParticles;
    this.geometry = new THREE.BufferGeometry();

    // Pre-allocate buffers at max size
    const positions = new Float32Array(maxParticles * 3);
    const colors = new Float32Array(maxParticles * 3);
    const sizes = new Float32Array(maxParticles);
    const alphas = new Float32Array(maxParticles);

    // Initialize with default values
    for (let i = 0; i < maxParticles; i++) {
      sizes[i] = 1.0;
      alphas[i] = 1.0;
    }

    // Create attributes with dynamic usage hint
    this.positionAttribute = new THREE.BufferAttribute(positions, 3);
    this.positionAttribute.setUsage(THREE.DynamicDrawUsage);

    this.colorAttribute = new THREE.BufferAttribute(colors, 3);
    this.colorAttribute.setUsage(THREE.DynamicDrawUsage);

    this.sizeAttribute = new THREE.BufferAttribute(sizes, 1);
    this.sizeAttribute.setUsage(THREE.DynamicDrawUsage);

    this.alphaAttribute = new THREE.BufferAttribute(alphas, 1);
    this.alphaAttribute.setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setAttribute('customColor', this.colorAttribute);
    this.geometry.setAttribute('size', this.sizeAttribute);
    this.geometry.setAttribute('alpha', this.alphaAttribute);

    // Set draw range to current particle count
    this.geometry.setDrawRange(0, maxParticles);
  }

  get particleCount(): number {
    return this._particleCount;
  }

  get maxParticles(): number {
    return this._maxParticles;
  }

  /**
   * Set the active particle count (doesn't reallocate)
   */
  setParticleCount(count: number): void {
    this._particleCount = Math.min(count, this._maxParticles);
    this.geometry.setDrawRange(0, this._particleCount);
  }

  /**
   * Get the geometry for use with Points
   */
  getGeometry(): THREE.BufferGeometry {
    return this.geometry;
  }

  /**
   * Update positions from a Float32Array
   */
  updatePositions(data: Float32Array, offset = 0): void {
    const array = this.positionAttribute.array as Float32Array;
    array.set(data, offset);
    this.positionAttribute.needsUpdate = true;
  }

  /**
   * Update colors from a Float32Array
   */
  updateColors(data: Float32Array, offset = 0): void {
    const array = this.colorAttribute.array as Float32Array;
    array.set(data, offset);
    this.colorAttribute.needsUpdate = true;
  }

  /**
   * Update sizes from a Float32Array
   */
  updateSizes(data: Float32Array, offset = 0): void {
    const array = this.sizeAttribute.array as Float32Array;
    array.set(data, offset);
    this.sizeAttribute.needsUpdate = true;
  }

  /**
   * Update alphas from a Float32Array
   */
  updateAlphas(data: Float32Array, offset = 0): void {
    const array = this.alphaAttribute.array as Float32Array;
    array.set(data, offset);
    this.alphaAttribute.needsUpdate = true;
  }

  /**
   * Get direct access to position array for in-place updates
   */
  getPositionArray(): Float32Array {
    return this.positionAttribute.array as Float32Array;
  }

  /**
   * Mark positions as needing update
   */
  markPositionsNeedUpdate(): void {
    this.positionAttribute.needsUpdate = true;
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.geometry.dispose();
  }
}

/**
 * Configuration for instanced particle rendering
 */
export interface InstancedParticleConfig {
  maxParticles: number;
  usePool: boolean;
}

/**
 * Create optimized particle points with instancing-friendly setup
 */
export function createOptimizedParticlePoints(
  geometry: THREE.BufferGeometry,
  material: THREE.Material
): THREE.Points {
  const points = new THREE.Points(geometry, material);

  // Disable frustum culling for always-visible orb
  points.frustumCulled = false;

  // Enable matrix auto-update optimization
  points.matrixAutoUpdate = false;
  points.updateMatrix();

  return points;
}

/**
 * Batch position update with smooth interpolation
 */
export function interpolatePositions(
  source: Float32Array,
  target: Float32Array,
  result: Float32Array,
  t: number
): void {
  const count = Math.min(source.length, target.length, result.length);
  const oneMinusT = 1 - t;

  for (let i = 0; i < count; i++) {
    result[i] = source[i] * oneMinusT + target[i] * t;
  }
}

/**
 * Smooth easing function for particle transitions
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Performance hints for different particle counts
 */
export const PARTICLE_COUNT_TIERS = {
  minimal: 2000,
  low: 3000,
  medium: 5000,
  high: 8000,
  ultra: 15000,
  maximum: 20000,
};

/**
 * Get recommended settings for a particle count
 */
export function getParticleRenderSettings(count: number): {
  useInstancing: boolean;
  batchUpdates: boolean;
  updateFrequency: number;
} {
  if (count <= PARTICLE_COUNT_TIERS.low) {
    return {
      useInstancing: false,
      batchUpdates: false,
      updateFrequency: 60,
    };
  }

  if (count <= PARTICLE_COUNT_TIERS.medium) {
    return {
      useInstancing: true,
      batchUpdates: false,
      updateFrequency: 60,
    };
  }

  if (count <= PARTICLE_COUNT_TIERS.high) {
    return {
      useInstancing: true,
      batchUpdates: true,
      updateFrequency: 60,
    };
  }

  // Ultra and above
  return {
    useInstancing: true,
    batchUpdates: true,
    updateFrequency: 30, // Update every other frame
  };
}
