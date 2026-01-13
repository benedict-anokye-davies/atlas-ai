/**
 * Nova Desktop - GLSL Shaders for Particle System
 * Custom vertex and fragment shaders for glowing particles
 */

export const particleVertexShader = /* glsl */ `
  attribute float size;
  attribute vec3 customColor;
  attribute float alpha;
  
  varying vec3 vColor;
  varying float vAlpha;
  
  uniform float uTime;
  uniform float uScale;
  uniform float uTurbulence;
  
  // Simplex noise for turbulence
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    
    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
  
  void main() {
    vColor = customColor;
    vAlpha = alpha;
    
    // Add turbulence based on state
    vec3 pos = position;
    if (uTurbulence > 0.0) {
      float noise = snoise(pos * 0.5 + uTime * 0.5);
      pos += normalize(pos) * noise * uTurbulence;
    }
    
    vec4 mvPosition = modelViewMatrix * vec4(pos * uScale, 1.0);
    
    // Size attenuation based on distance
    float sizeAtten = size * (300.0 / -mvPosition.z);
    gl_PointSize = clamp(sizeAtten, 1.0, 15.0);
    
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const particleFragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  
  uniform float uGlow;
  
  void main() {
    // Distance from center of point
    float dist = length(gl_PointCoord - vec2(0.5));
    
    // Soft circular falloff with glow
    float strength = 1.0 - smoothstep(0.0, 0.5, dist);
    
    // Add glow effect
    float glow = exp(-dist * 4.0) * uGlow;
    strength += glow;
    
    // Discard pixels outside radius
    if (dist > 0.5) discard;
    
    // Final color with bloom
    vec3 color = vColor * (1.0 + glow * 0.5);
    
    gl_FragColor = vec4(color, strength * vAlpha);
  }
`;

/**
 * Post-processing bloom shader (optional enhancement)
 */
export const bloomVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const bloomFragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uBloomStrength;
  varying vec2 vUv;
  
  void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    
    // Simple bloom by brightening
    float brightness = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 bloom = color.rgb * smoothstep(0.5, 1.0, brightness) * uBloomStrength;
    
    gl_FragColor = vec4(color.rgb + bloom, color.a);
  }
`;
