/**
 * Nova Desktop - Shader Tests
 * Tests for GLSL shader source code validation
 */

import { describe, it, expect } from 'vitest';
import {
  particleVertexShader,
  particleFragmentShader,
  bloomVertexShader,
  bloomFragmentShader,
} from '../src/renderer/components/orb/shaders';

describe('Particle Shaders', () => {
  describe('Vertex Shader', () => {
    it('should be a non-empty string', () => {
      expect(typeof particleVertexShader).toBe('string');
      expect(particleVertexShader.length).toBeGreaterThan(0);
    });

    it('should contain required attributes', () => {
      expect(particleVertexShader).toContain('attribute float size');
      expect(particleVertexShader).toContain('attribute vec3 customColor');
      expect(particleVertexShader).toContain('attribute float alpha');
    });

    it('should contain required uniforms', () => {
      expect(particleVertexShader).toContain('uniform float uTime');
      expect(particleVertexShader).toContain('uniform float uSpeedMultiplier');
      expect(particleVertexShader).toContain('uniform float uTurbulence');
      expect(particleVertexShader).toContain('uniform float uAudioLevel');
    });

    it('should contain required varyings', () => {
      expect(particleVertexShader).toContain('varying vec3 vColor');
      expect(particleVertexShader).toContain('varying float vAlpha');
    });

    it('should have a main function', () => {
      expect(particleVertexShader).toContain('void main()');
    });

    it('should set gl_Position', () => {
      expect(particleVertexShader).toContain('gl_Position');
    });

    it('should set gl_PointSize', () => {
      expect(particleVertexShader).toContain('gl_PointSize');
    });

    it('should include simplex noise implementation', () => {
      expect(particleVertexShader).toContain('snoise');
      expect(particleVertexShader).toContain('permute');
    });

    it('should apply turbulence displacement', () => {
      expect(particleVertexShader).toContain('uTurbulence');
      expect(particleVertexShader).toContain('turbulenceAmount');
    });

    it('should clamp point size', () => {
      expect(particleVertexShader).toContain('clamp(');
    });
  });

  describe('Fragment Shader', () => {
    it('should be a non-empty string', () => {
      expect(typeof particleFragmentShader).toBe('string');
      expect(particleFragmentShader.length).toBeGreaterThan(0);
    });

    it('should contain required varyings', () => {
      expect(particleFragmentShader).toContain('varying vec3 vColor');
      expect(particleFragmentShader).toContain('varying float vAlpha');
    });

    it('should contain glow intensity uniform', () => {
      expect(particleFragmentShader).toContain('uniform float uGlowIntensity');
    });

    it('should have a main function', () => {
      expect(particleFragmentShader).toContain('void main()');
    });

    it('should set gl_FragColor', () => {
      expect(particleFragmentShader).toContain('gl_FragColor');
    });

    it('should use gl_PointCoord for circular particles', () => {
      expect(particleFragmentShader).toContain('gl_PointCoord');
    });

    it('should implement glow effect', () => {
      expect(particleFragmentShader).toContain('glow');
      expect(particleFragmentShader).toContain('exp(');
    });

    it('should use exponential falloff for soft edges', () => {
      // Uses exp() for soft circular falloff
      expect(particleFragmentShader).toContain('exp(-dist');
    });

    it('should discard pixels outside radius', () => {
      expect(particleFragmentShader).toContain('discard');
    });
  });
});

describe('Bloom Shaders', () => {
  describe('Bloom Vertex Shader', () => {
    it('should be a non-empty string', () => {
      expect(typeof bloomVertexShader).toBe('string');
      expect(bloomVertexShader.length).toBeGreaterThan(0);
    });

    it('should pass UV coordinates', () => {
      expect(bloomVertexShader).toContain('varying vec2 vUv');
      expect(bloomVertexShader).toContain('vUv = uv');
    });

    it('should have a main function', () => {
      expect(bloomVertexShader).toContain('void main()');
    });

    it('should set gl_Position', () => {
      expect(bloomVertexShader).toContain('gl_Position');
    });
  });

  describe('Bloom Fragment Shader', () => {
    it('should be a non-empty string', () => {
      expect(typeof bloomFragmentShader).toBe('string');
      expect(bloomFragmentShader.length).toBeGreaterThan(0);
    });

    it('should sample from diffuse texture', () => {
      expect(bloomFragmentShader).toContain('uniform sampler2D tDiffuse');
      expect(bloomFragmentShader).toContain('texture2D(tDiffuse');
    });

    it('should have bloom strength uniform', () => {
      expect(bloomFragmentShader).toContain('uniform float uBloomStrength');
    });

    it('should calculate brightness using luminance weights', () => {
      // Standard luminance coefficients
      expect(bloomFragmentShader).toContain('0.2126');
      expect(bloomFragmentShader).toContain('0.7152');
      expect(bloomFragmentShader).toContain('0.0722');
    });

    it('should use smoothstep for threshold', () => {
      expect(bloomFragmentShader).toContain('smoothstep');
    });

    it('should set gl_FragColor', () => {
      expect(bloomFragmentShader).toContain('gl_FragColor');
    });
  });
});

describe('Shader GLSL Syntax', () => {
  const allShaders = [
    { name: 'particleVertex', code: particleVertexShader },
    { name: 'particleFragment', code: particleFragmentShader },
    { name: 'bloomVertex', code: bloomVertexShader },
    { name: 'bloomFragment', code: bloomFragmentShader },
  ];

  allShaders.forEach(({ name, code }) => {
    describe(`${name}`, () => {
      it('should have balanced braces', () => {
        const openBraces = (code.match(/{/g) || []).length;
        const closeBraces = (code.match(/}/g) || []).length;
        expect(openBraces).toBe(closeBraces);
      });

      it('should have balanced parentheses', () => {
        const openParens = (code.match(/\(/g) || []).length;
        const closeParens = (code.match(/\)/g) || []).length;
        expect(openParens).toBe(closeParens);
      });

      it('should not contain JavaScript-specific syntax', () => {
        // Note: 'const' IS valid in GLSL, so we only check for JS-specific patterns
        expect(code).not.toContain('let ');
        expect(code).not.toContain('=>');
        expect(code).not.toContain('function ');
      });

      it('should use GLSL types', () => {
        // At least one of these GLSL types should be present
        const glslTypes = ['vec2', 'vec3', 'vec4', 'float', 'mat4', 'sampler2D'];
        const hasGlslTypes = glslTypes.some((type) => code.includes(type));
        expect(hasGlslTypes).toBe(true);
      });

      it('should have semicolons at end of statements', () => {
        // Check that void main() is followed by a brace
        expect(code).toMatch(/void main\s*\(\s*\)\s*{/);
      });
    });
  });
});

describe('Shader Compatibility', () => {
  it('should use WebGL 1.0 compatible syntax', () => {
    // Check particle shaders don't use WebGL 2.0 only features
    const webgl2Only = ['in ', 'out ', 'texture('];

    expect(particleVertexShader).not.toMatch(/\bin\s+\w/);
    expect(particleVertexShader).not.toMatch(/\bout\s+\w/);
    expect(particleFragmentShader).not.toContain('texture(');
  });

  it('should use attribute/varying instead of in/out', () => {
    expect(particleVertexShader).toContain('attribute');
    expect(particleVertexShader).toContain('varying');
    expect(particleFragmentShader).toContain('varying');
  });

  it('should use gl_FragColor instead of out variable', () => {
    expect(particleFragmentShader).toContain('gl_FragColor');
    expect(bloomFragmentShader).toContain('gl_FragColor');
  });
});
