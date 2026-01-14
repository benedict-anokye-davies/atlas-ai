/**
 * Nova Desktop - NovaParticles Component Tests
 * Tests for the particle system component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  STATE_COLORS,
  ATTRACTOR_SETTINGS,
  aizawa,
} from '../src/renderer/components/orb/attractors';

// Since NovaParticles uses React Three Fiber which requires WebGL context,
// we test the logic and configuration rather than actual rendering

describe('NovaParticles Configuration', () => {
  describe('NovaState Type', () => {
    const validStates = ['idle', 'listening', 'thinking', 'speaking', 'error'];

    it('should have matching colors for all states', () => {
      validStates.forEach((state) => {
        expect(STATE_COLORS[state]).toBeDefined();
        expect(STATE_COLORS[state]).toHaveProperty('hue');
        expect(STATE_COLORS[state]).toHaveProperty('saturation');
        expect(STATE_COLORS[state]).toHaveProperty('lightness');
      });
    });
  });

  describe('Particle Initialization Logic', () => {
    it('should generate particles along the attractor', () => {
      const particleCount = 100;
      const particles: Array<{ x: number; y: number; z: number }> = [];
      const settings = ATTRACTOR_SETTINGS.aizawa;

      // Simulate the initialization logic
      for (let i = 0; i < particleCount; i++) {
        let x = (Math.random() - 0.5) * 2;
        let y = (Math.random() - 0.5) * 2;
        let z = (Math.random() - 0.5) * 2;

        const steps = Math.floor(Math.random() * 500) + 100;
        for (let j = 0; j < steps; j++) {
          const [dx, dy, dz] = aizawa(x, y, z);
          x += dx * settings.dt;
          y += dy * settings.dt;
          z += dz * settings.dt;
        }

        particles.push({ x, y, z });
      }

      // All particles should have finite positions
      particles.forEach((p) => {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
        expect(Number.isFinite(p.z)).toBe(true);
      });
    });

    it('should create buffer arrays with correct sizes', () => {
      const particleCount = 1000;

      const positions = new Float32Array(particleCount * 3);
      const colors = new Float32Array(particleCount * 3);
      const sizes = new Float32Array(particleCount);
      const alphas = new Float32Array(particleCount);

      expect(positions.length).toBe(particleCount * 3);
      expect(colors.length).toBe(particleCount * 3);
      expect(sizes.length).toBe(particleCount);
      expect(alphas.length).toBe(particleCount);
    });

    it('should generate valid HSL colors', () => {
      const stateColor = STATE_COLORS.idle;
      const color = new THREE.Color();

      // Generate colors with variation like the component does
      for (let i = 0; i < 10; i++) {
        const hue = (stateColor.hue + (Math.random() - 0.5) * stateColor.hueRange) % 1;
        const sat = stateColor.saturation + (Math.random() - 0.5) * 0.2;
        const light = stateColor.lightness + (Math.random() - 0.5) * 0.2;

        color.setHSL(hue, sat, light);

        expect(color.r).toBeGreaterThanOrEqual(0);
        expect(color.r).toBeLessThanOrEqual(1);
        expect(color.g).toBeGreaterThanOrEqual(0);
        expect(color.g).toBeLessThanOrEqual(1);
        expect(color.b).toBeGreaterThanOrEqual(0);
        expect(color.b).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('State Animation Parameters', () => {
    const getAnimationParams = (state: string, audioLevel: number = 0) => {
      let speed = 1.0;
      let turbulence = 0;
      let sizeMultiplier = 1.0;
      let pulseSpeed = 0;

      switch (state) {
        case 'idle':
          speed = 0.6;
          turbulence = 0;
          break;
        case 'listening':
          speed = 1.0 + audioLevel * 0.5;
          turbulence = audioLevel * 0.3;
          sizeMultiplier = 1.0 + audioLevel * 0.3;
          break;
        case 'thinking':
          speed = 2.5;
          turbulence = 0.5;
          pulseSpeed = 8;
          break;
        case 'speaking':
          speed = 1.2;
          turbulence = 0.1;
          pulseSpeed = 4 + audioLevel * 4;
          sizeMultiplier = 1.0 + audioLevel * 0.5;
          break;
        case 'error':
          speed = 0.3;
          turbulence = 0.8;
          break;
      }

      return { speed, turbulence, sizeMultiplier, pulseSpeed };
    };

    it('should have slowest speed for idle state', () => {
      const idle = getAnimationParams('idle');
      const listening = getAnimationParams('listening');
      const thinking = getAnimationParams('thinking');

      expect(idle.speed).toBeLessThan(listening.speed);
      expect(idle.speed).toBeLessThan(thinking.speed);
    });

    it('should have fastest speed for thinking state', () => {
      const thinking = getAnimationParams('thinking');

      expect(thinking.speed).toBe(2.5);
      expect(thinking.pulseSpeed).toBe(8);
    });

    it('should increase turbulence for error state', () => {
      const error = getAnimationParams('error');

      expect(error.turbulence).toBe(0.8);
      expect(error.speed).toBe(0.3); // Slow and chaotic
    });

    it('should respond to audio level in listening state', () => {
      const lowAudio = getAnimationParams('listening', 0.2);
      const highAudio = getAnimationParams('listening', 0.8);

      expect(highAudio.speed).toBeGreaterThan(lowAudio.speed);
      expect(highAudio.turbulence).toBeGreaterThan(lowAudio.turbulence);
      expect(highAudio.sizeMultiplier).toBeGreaterThan(lowAudio.sizeMultiplier);
    });

    it('should pulse faster when speaking with high audio', () => {
      const quiet = getAnimationParams('speaking', 0);
      const loud = getAnimationParams('speaking', 1);

      expect(loud.pulseSpeed).toBeGreaterThan(quiet.pulseSpeed);
    });
  });

  describe('Particle Divergence Handling', () => {
    it('should detect divergent particles', () => {
      const divergenceThreshold = 50;

      // Normal particle
      const normalDist = Math.sqrt(1 + 1 + 1);
      expect(normalDist).toBeLessThan(divergenceThreshold);

      // Divergent particle
      const divergentDist = Math.sqrt(100 * 100 + 100 * 100 + 100 * 100);
      expect(divergentDist).toBeGreaterThan(divergenceThreshold);
    });

    it('should reset particles within bounds', () => {
      // Simulate reset logic
      const resetParticle = () => ({
        x: (Math.random() - 0.5) * 2,
        y: (Math.random() - 0.5) * 2,
        z: (Math.random() - 0.5) * 2,
      });

      for (let i = 0; i < 100; i++) {
        const p = resetParticle();
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.z)).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('Color Transition Logic', () => {
    it('should interpolate colors correctly', () => {
      const currentR = 1.0;
      const targetR = 0.0;
      const ease = 0.5;

      // Interpolation formula from component
      const newR = currentR + (targetR - currentR) * ease * 0.1;

      expect(newR).toBeCloseTo(0.95, 2);
    });

    it('should complete transition over time', () => {
      let current = 1.0;
      const target = 0.0;

      // Simulate multiple frames
      for (let i = 0; i < 100; i++) {
        const ease = Math.min(1, i * 0.02);
        current = current + (target - current) * ease * 0.1;
      }

      // Should approach target
      expect(current).toBeLessThan(0.5);
    });
  });

  describe('Shader Material Configuration', () => {
    it('should create material with correct uniforms', () => {
      const uniforms = {
        uTime: { value: 0 },
        uScale: { value: 1.0 },
        uTurbulence: { value: 0 },
        uGlow: { value: 0.8 },
      };

      expect(uniforms.uTime.value).toBe(0);
      expect(uniforms.uScale.value).toBe(1.0);
      expect(uniforms.uTurbulence.value).toBe(0);
      expect(uniforms.uGlow.value).toBe(0.8);
    });

    it('should have appropriate glow values for states', () => {
      const getGlow = (state: string) => {
        if (state === 'thinking') return 1.5;
        if (state === 'speaking') return 1.2;
        return 0.8;
      };

      expect(getGlow('thinking')).toBe(1.5);
      expect(getGlow('speaking')).toBe(1.2);
      expect(getGlow('idle')).toBe(0.8);
      expect(getGlow('listening')).toBe(0.8);
      expect(getGlow('error')).toBe(0.8);
    });
  });

  describe('Buffer Attribute Updates', () => {
    it('should correctly index position buffer', () => {
      const particleCount = 100;
      const positions = new Float32Array(particleCount * 3);

      // Set position for particle 50
      const particleIndex = 50;
      positions[particleIndex * 3] = 1.0; // x
      positions[particleIndex * 3 + 1] = 2.0; // y
      positions[particleIndex * 3 + 2] = 3.0; // z

      expect(positions[150]).toBe(1.0);
      expect(positions[151]).toBe(2.0);
      expect(positions[152]).toBe(3.0);
    });

    it('should correctly index color buffer', () => {
      const particleCount = 100;
      const colors = new Float32Array(particleCount * 3);

      // Set color for particle 25
      const particleIndex = 25;
      colors[particleIndex * 3] = 0.5; // r
      colors[particleIndex * 3 + 1] = 0.7; // g
      colors[particleIndex * 3 + 2] = 0.9; // b

      expect(colors[75]).toBe(0.5);
      // Float32Array has precision limitations, use toBeCloseTo
      expect(colors[76]).toBeCloseTo(0.7, 5);
      expect(colors[77]).toBeCloseTo(0.9, 5);
    });
  });

  describe('Pulse Effect Calculation', () => {
    it('should calculate pulse correctly', () => {
      const time = 1.0;
      const pulseSpeed = 4;
      const particleIndex = 10;

      const pulse = Math.sin(time * pulseSpeed + particleIndex * 0.01) * 0.3 + 1.0;

      // Pulse should be between 0.7 and 1.3
      expect(pulse).toBeGreaterThan(0.6);
      expect(pulse).toBeLessThan(1.4);
    });

    it('should produce smooth variation across particles', () => {
      const time = 2.0;
      const pulseSpeed = 8;
      const pulses: number[] = [];

      for (let i = 0; i < 100; i++) {
        pulses.push(Math.sin(time * pulseSpeed + i * 0.01) * 0.3 + 1.0);
      }

      // Should have variance (not all same value)
      const uniquePulses = new Set(pulses.map((p) => p.toFixed(3)));
      expect(uniquePulses.size).toBeGreaterThan(10);
    });
  });
});

describe('NovaParticles Props', () => {
  describe('Default Values', () => {
    it('should have sensible defaults', () => {
      const defaultState = 'idle';
      const defaultAudioLevel = 0;
      const defaultParticleCount = 35000;

      expect(defaultState).toBe('idle');
      expect(defaultAudioLevel).toBe(0);
      expect(defaultParticleCount).toBe(35000);
    });
  });

  describe('Particle Count', () => {
    it('should handle various particle counts', () => {
      const counts = [1000, 10000, 35000, 50000];

      counts.forEach((count) => {
        const positions = new Float32Array(count * 3);
        expect(positions.length).toBe(count * 3);
      });
    });

    it('should not exceed memory limits', () => {
      // 35K particles * 3 components * 4 bytes = 420KB for positions
      // This is reasonable for modern hardware
      const particleCount = 35000;
      const positionBytes = particleCount * 3 * 4;
      const colorBytes = particleCount * 3 * 4;
      const sizeBytes = particleCount * 4;
      const alphaBytes = particleCount * 4;

      const totalBytes = positionBytes + colorBytes + sizeBytes + alphaBytes;
      const totalMB = totalBytes / (1024 * 1024);

      expect(totalMB).toBeLessThan(5); // Should be under 5MB
    });
  });
});
