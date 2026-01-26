/**
 * Atlas Desktop - Noise Shader Library
 * Comprehensive noise functions for particle distortion and animation
 *
 * Features:
 * - Simplex noise (2D, 3D, 4D)
 * - Curl noise for divergence-free flow
 * - Fractal Brownian Motion (FBM)
 * - Voronoi/Worley noise
 * - Domain warping utilities
 * - State-responsive distortion
 * - GPU-optimized implementations
 */

precision highp float;

//=============================================================================
// COMMON UNIFORMS
//=============================================================================

uniform float uTime;
uniform float uState;           // 0=idle, 1=listening, 2=thinking, 3=speaking, 4=error
uniform float uNoiseScale;      // Overall noise scale (0.1-5.0)
uniform float uNoiseSpeed;      // Animation speed (0.1-3.0)
uniform float uNoiseStrength;   // Distortion strength (0-1)
uniform float uNoiseLacunarity; // Frequency multiplier for FBM (1.5-3.0)
uniform float uNoisePersistence; // Amplitude decay for FBM (0.3-0.7)
uniform int uNoiseOctaves;      // Number of FBM octaves (1-8)

//=============================================================================
// HELPER FUNCTIONS
//=============================================================================

/**
 * mod289 - Keeps values in range to prevent precision issues
 */
vec2 mod289(vec2 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

/**
 * permute - Hash function for noise
 */
vec2 permute(vec2 x) {
  return mod289(((x * 34.0) + 1.0) * x);
}

vec3 permute(vec3 x) {
  return mod289(((x * 34.0) + 1.0) * x);
}

vec4 permute(vec4 x) {
  return mod289(((x * 34.0) + 1.0) * x);
}

/**
 * taylorInvSqrt - Fast inverse square root approximation
 */
vec3 taylorInvSqrt(vec3 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

/**
 * fade - Quintic Hermite interpolation
 */
vec2 fade(vec2 t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

vec3 fade(vec3 t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

//=============================================================================
// 2D SIMPLEX NOISE
//=============================================================================

/**
 * Simplex noise 2D
 * Returns value in range [-1, 1]
 */
float snoise2D(vec2 v) {
  const vec4 C = vec4(0.211324865405187,  // (3.0-sqrt(3.0))/6.0
                      0.366025403784439,  // 0.5*(sqrt(3.0)-1.0)
                      -0.577350269189626, // -1.0 + 2.0 * C.x
                      0.024390243902439); // 1.0 / 41.0

  // First corner
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);

  // Other corners
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;

  // Permutations
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));

  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;

  // Gradients
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;

  // Normalize gradients implicitly
  m *= taylorInvSqrt(a0 * a0 + h * h);

  // Compute final noise value
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

//=============================================================================
// 3D SIMPLEX NOISE
//=============================================================================

/**
 * Simplex noise 3D
 * Returns value in range [-1, 1]
 */
float snoise3D(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  // First corner
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  // Other corners
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  // Permutations
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  // Gradients
  float n_ = 0.142857142857; // 1.0/7.0
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

  // Normalize gradients
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  // Mix final noise value
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

//=============================================================================
// 4D SIMPLEX NOISE
//=============================================================================

/**
 * Simplex noise 4D - Useful for time-varying 3D noise
 * Returns value in range [-1, 1]
 */
float snoise4D(vec4 v) {
  const vec4 C = vec4(
    0.138196601125011,  // (5 - sqrt(5))/20  G4
    0.276393202250021,  // 2 * G4
    0.414589803375032,  // 3 * G4
    -0.447213595499958  // -1 + 4 * G4
  );

  // First corner
  vec4 i = floor(v + dot(v, vec4(0.309016994374947451)));
  vec4 x0 = v - i + dot(i, C.xxxx);

  // Rank sorting
  vec4 i0;
  vec3 isX = step(x0.yzw, x0.xxx);
  vec3 isYZ = step(x0.zww, x0.yyz);
  i0.x = isX.x + isX.y + isX.z;
  i0.yzw = 1.0 - isX;
  i0.y += isYZ.x + isYZ.y;
  i0.zw += 1.0 - isYZ.xy;
  i0.z += isYZ.z;
  i0.w += 1.0 - isYZ.z;

  vec4 i3 = clamp(i0, 0.0, 1.0);
  vec4 i2 = clamp(i0 - 1.0, 0.0, 1.0);
  vec4 i1 = clamp(i0 - 2.0, 0.0, 1.0);

  vec4 x1 = x0 - i1 + C.xxxx;
  vec4 x2 = x0 - i2 + C.yyyy;
  vec4 x3 = x0 - i3 + C.zzzz;
  vec4 x4 = x0 + C.wwww;

  // Permutations
  i = mod289(i);
  float j0 = permute(permute(permute(permute(i.w) + i.z) + i.y) + i.x).x;
  vec4 j1 = permute(permute(permute(permute(
      i.w + vec4(i1.w, i2.w, i3.w, 1.0))
    + i.z + vec4(i1.z, i2.z, i3.z, 1.0))
    + i.y + vec4(i1.y, i2.y, i3.y, 1.0))
    + i.x + vec4(i1.x, i2.x, i3.x, 1.0));

  // Gradients
  vec4 ip = vec4(1.0 / 294.0, 1.0 / 49.0, 1.0 / 7.0, 0.0);

  vec4 p0 = grad4(j0, ip);
  vec4 p1 = grad4(j1.x, ip);
  vec4 p2 = grad4(j1.y, ip);
  vec4 p3 = grad4(j1.z, ip);
  vec4 p4 = grad4(j1.w, ip);

  // Normalize gradients
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  float n4norm = taylorInvSqrt(vec4(dot(p4, p4), 0.0, 0.0, 0.0)).x;
  p4 *= n4norm;

  // Mix contributions
  vec3 m0 = max(0.6 - vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2)), 0.0);
  vec2 m1 = max(0.6 - vec2(dot(x3, x3), dot(x4, x4)), 0.0);
  m0 = m0 * m0;
  m1 = m1 * m1;
  return 49.0 * (dot(m0 * m0, vec3(dot(p0, x0), dot(p1, x1), dot(p2, x2)))
               + dot(m1 * m1, vec2(dot(p3, x3), dot(p4, x4))));
}

// Gradient helper for 4D noise
vec4 grad4(float j, vec4 ip) {
  const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);
  vec4 p, s;

  p.xyz = floor(fract(vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
  p.w = 1.5 - dot(abs(p.xyz), ones.xyz);
  s = vec4(lessThan(p, vec4(0.0)));
  p.xyz = p.xyz + (s.xyz * 2.0 - 1.0) * s.www;

  return p;
}

//=============================================================================
// CURL NOISE
//=============================================================================

/**
 * 3D Curl noise - Divergence-free vector field
 * Creates smooth, swirling motion patterns
 */
vec3 curlNoise(vec3 p) {
  const float e = 0.1;

  // Sample noise at offset positions
  float n1 = snoise3D(p + vec3(e, 0.0, 0.0));
  float n2 = snoise3D(p - vec3(e, 0.0, 0.0));
  float n3 = snoise3D(p + vec3(0.0, e, 0.0));
  float n4 = snoise3D(p - vec3(0.0, e, 0.0));
  float n5 = snoise3D(p + vec3(0.0, 0.0, e));
  float n6 = snoise3D(p - vec3(0.0, 0.0, e));

  // Compute curl as cross product of gradient
  float x = (n4 - n3) - (n6 - n5);
  float y = (n6 - n5) - (n2 - n1);
  float z = (n2 - n1) - (n4 - n3);

  return normalize(vec3(x, y, z));
}

/**
 * Curl noise with custom potential field
 * More control over the flow patterns
 */
vec3 curlNoisePotential(vec3 p, float time) {
  const float e = 0.0001;

  // Create potential field from 3 different noise octaves
  vec3 p1 = p + vec3(0.0, time * 0.1, 0.0);

  // Compute partial derivatives numerically
  float dxdy = snoise3D(p1 + vec3(0.0, e, 0.0)) - snoise3D(p1 - vec3(0.0, e, 0.0));
  float dxdz = snoise3D(p1 + vec3(0.0, 0.0, e)) - snoise3D(p1 - vec3(0.0, 0.0, e));
  float dydx = snoise3D(p1 + vec3(e, 0.0, 0.0)) - snoise3D(p1 - vec3(e, 0.0, 0.0));
  float dydz = snoise3D(p1 + vec3(0.0, 0.0, e)) - snoise3D(p1 - vec3(0.0, 0.0, e));
  float dzdx = snoise3D(p1 + vec3(e, 0.0, 0.0)) - snoise3D(p1 - vec3(e, 0.0, 0.0));
  float dzdy = snoise3D(p1 + vec3(0.0, e, 0.0)) - snoise3D(p1 - vec3(0.0, e, 0.0));

  return vec3(dydz - dzdy, dzdx - dxdz, dxdy - dydx) / (2.0 * e);
}

//=============================================================================
// FRACTAL BROWNIAN MOTION (FBM)
//=============================================================================

/**
 * 2D FBM with configurable octaves
 */
float fbm2D(vec2 p, int octaves, float lacunarity, float persistence) {
  float value = 0.0;
  float amplitude = 1.0;
  float frequency = 1.0;
  float maxValue = 0.0;

  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    value += amplitude * snoise2D(p * frequency);
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return value / maxValue;
}

/**
 * 3D FBM with configurable octaves
 */
float fbm3D(vec3 p, int octaves, float lacunarity, float persistence) {
  float value = 0.0;
  float amplitude = 1.0;
  float frequency = 1.0;
  float maxValue = 0.0;

  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    value += amplitude * snoise3D(p * frequency);
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return value / maxValue;
}

/**
 * Ridged FBM - Creates sharp ridged patterns
 */
float ridgedFbm3D(vec3 p, int octaves, float lacunarity, float persistence) {
  float value = 0.0;
  float amplitude = 1.0;
  float frequency = 1.0;
  float maxValue = 0.0;
  float weight = 1.0;

  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;

    // Absolute value creates ridges
    float n = 1.0 - abs(snoise3D(p * frequency));
    n = n * n * weight;

    value += amplitude * n;
    maxValue += amplitude;
    weight = clamp(n * 2.0, 0.0, 1.0);

    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return value / maxValue;
}

//=============================================================================
// VORONOI / WORLEY NOISE
//=============================================================================

/**
 * 2D Voronoi noise
 * Returns distance to nearest cell center
 */
float voronoi2D(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);

  float minDist = 8.0;

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(
        snoise2D(n + g) * 0.5 + 0.5,
        snoise2D((n + g) * 1.3 + 17.0) * 0.5 + 0.5
      );
      vec2 r = g + o - f;
      float d = dot(r, r);
      minDist = min(minDist, d);
    }
  }

  return sqrt(minDist);
}

/**
 * 3D Voronoi noise
 */
float voronoi3D(vec3 p) {
  vec3 n = floor(p);
  vec3 f = fract(p);

  float minDist = 8.0;

  for (int k = -1; k <= 1; k++) {
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec3 g = vec3(float(i), float(j), float(k));
        vec3 o = vec3(
          snoise3D(n + g) * 0.5 + 0.5,
          snoise3D((n + g) * 1.3 + 17.0) * 0.5 + 0.5,
          snoise3D((n + g) * 0.7 + 31.0) * 0.5 + 0.5
        );
        vec3 r = g + o - f;
        float d = dot(r, r);
        minDist = min(minDist, d);
      }
    }
  }

  return sqrt(minDist);
}

//=============================================================================
// DOMAIN WARPING
//=============================================================================

/**
 * Domain warp using noise to distort coordinates
 */
vec3 domainWarp(vec3 p, float strength, float time) {
  vec3 offset = vec3(
    snoise3D(p + time * 0.1),
    snoise3D(p + vec3(5.2, 1.3, 2.8) + time * 0.1),
    snoise3D(p + vec3(9.7, 4.1, 6.5) + time * 0.1)
  );
  return p + offset * strength;
}

/**
 * Multi-level domain warping for more complex distortions
 */
vec3 multiLevelWarp(vec3 p, float strength, float time) {
  vec3 q = domainWarp(p, strength * 0.5, time);
  vec3 r = domainWarp(q * 0.5, strength * 0.3, time * 0.5);
  return p + (r - p) * strength;
}

//=============================================================================
// STATE-RESPONSIVE DISTORTION
//=============================================================================

/**
 * Get distortion parameters based on current state
 */
vec4 getStateDistortion() {
  // Returns: vec4(intensity, frequency, speed, turbulence)
  if (uState < 0.5) {
    // Idle - gentle, slow waves
    return vec4(0.3, 1.0, 0.3, 0.1);
  } else if (uState < 1.5) {
    // Listening - subtle ripples
    return vec4(0.5, 1.5, 0.5, 0.2);
  } else if (uState < 2.5) {
    // Thinking - complex, rapid patterns
    return vec4(0.8, 2.5, 1.5, 0.6);
  } else if (uState < 3.5) {
    // Speaking - rhythmic pulses
    return vec4(0.6, 2.0, 1.0, 0.3);
  } else {
    // Error - chaotic distortion
    return vec4(1.0, 3.0, 2.0, 0.9);
  }
}

/**
 * Apply state-responsive distortion to position
 */
vec3 applyStateDistortion(vec3 position) {
  vec4 params = getStateDistortion();
  float intensity = params.x * uNoiseStrength;
  float frequency = params.y * uNoiseScale;
  float speed = params.z * uNoiseSpeed;
  float turbulence = params.w;

  // Time-based animation
  float t = uTime * speed;

  // Base noise distortion
  vec3 noisePos = position * frequency + t;
  vec3 distortion = curlNoise(noisePos) * intensity;

  // Add turbulence for more chaotic states
  if (turbulence > 0.0) {
    vec3 turbNoise = vec3(
      fbm3D(noisePos * 2.0, uNoiseOctaves, uNoiseLacunarity, uNoisePersistence),
      fbm3D(noisePos * 2.0 + 10.0, uNoiseOctaves, uNoiseLacunarity, uNoisePersistence),
      fbm3D(noisePos * 2.0 + 20.0, uNoiseOctaves, uNoiseLacunarity, uNoisePersistence)
    );
    distortion += turbNoise * turbulence * intensity * 0.5;
  }

  return position + distortion;
}

//=============================================================================
// FRAGMENT SHADER UTILITIES
//=============================================================================

#ifdef FRAGMENT_SHADER

/**
 * Apply noise-based screen distortion
 */
vec2 screenDistort(vec2 uv) {
  vec4 params = getStateDistortion();
  float strength = params.x * uNoiseStrength * 0.02;

  vec2 offset = vec2(
    snoise2D(uv * params.y * 10.0 + uTime * params.z),
    snoise2D(uv * params.y * 10.0 + uTime * params.z + 100.0)
  );

  return uv + offset * strength;
}

/**
 * Apply chromatic aberration based on noise
 */
vec3 chromaticAberration(sampler2D tex, vec2 uv, float strength) {
  vec4 params = getStateDistortion();
  float aberration = strength * params.x * 0.005;

  // Noise-based offset direction
  float angle = snoise2D(uv * 5.0 + uTime) * 3.14159;
  vec2 dir = vec2(cos(angle), sin(angle)) * aberration;

  float r = texture2D(tex, uv + dir).r;
  float g = texture2D(tex, uv).g;
  float b = texture2D(tex, uv - dir).b;

  return vec3(r, g, b);
}

/**
 * Apply noise-based vignette
 */
float noiseVignette(vec2 uv, float strength) {
  vec2 center = uv - 0.5;
  float dist = length(center);

  // Add noise to vignette edge
  float noise = snoise2D(uv * 10.0 + uTime * 0.5) * 0.1;
  float vignette = 1.0 - smoothstep(0.3, 0.7 + noise, dist * strength);

  return vignette;
}

#endif

//=============================================================================
// EXPORTS - Can be imported into other shaders
//=============================================================================

// Export main functions for use in particle vertex shader
// These would be included via shader chunking system

/*
EXPORTED_FUNCTIONS:
- snoise2D(vec2) -> float
- snoise3D(vec3) -> float
- snoise4D(vec4) -> float
- curlNoise(vec3) -> vec3
- curlNoisePotential(vec3, float) -> vec3
- fbm2D(vec2, int, float, float) -> float
- fbm3D(vec3, int, float, float) -> float
- ridgedFbm3D(vec3, int, float, float) -> float
- voronoi2D(vec2) -> float
- voronoi3D(vec3) -> float
- domainWarp(vec3, float, float) -> vec3
- multiLevelWarp(vec3, float, float) -> vec3
- applyStateDistortion(vec3) -> vec3
*/
