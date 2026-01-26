/**
 * Atlas Desktop - Glow/Bloom Shader
 * Advanced glow effects for particle visualization
 *
 * Features:
 * - Multi-layer glow with configurable intensity
 * - State-responsive color tinting
 * - Anamorphic bloom support
 * - Energy-preserving brightness
 * - GPU-optimized calculations
 */

//=============================================================================
// GLOW VERTEX SHADER
//=============================================================================

// Use #ifdef to conditionally include vertex or fragment code
#ifdef VERTEX_SHADER

attribute vec3 position;
attribute vec2 uv;

varying vec2 vUv;
varying vec2 vScreenPos;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // Screen position for post-processing effects
  vScreenPos = gl_Position.xy / gl_Position.w * 0.5 + 0.5;
}

#endif

//=============================================================================
// GLOW FRAGMENT SHADER
//=============================================================================

#ifdef FRAGMENT_SHADER

precision highp float;

varying vec2 vUv;
varying vec2 vScreenPos;

// Input texture
uniform sampler2D tDiffuse;

// Glow parameters
uniform float uGlowStrength;      // Overall glow intensity (0-2)
uniform float uGlowRadius;        // Blur radius for glow (0-10)
uniform float uGlowThreshold;     // Brightness threshold for bloom (0-1)
uniform float uGlowSoftness;      // Edge softness (0-1)
uniform vec3 uGlowColor;          // Tint color for glow
uniform float uGlowSaturation;    // Color saturation of glow (0-2)

// State parameters
uniform float uState;             // 0=idle, 1=listening, 2=thinking, 3=speaking, 4=error
uniform float uTime;

// Anamorphic bloom settings
uniform bool uAnamorphic;         // Enable horizontal stretch
uniform float uAnamorphicRatio;   // Stretch ratio (1-3)

//-----------------------------------------------------------------------------
// Helper Functions
//-----------------------------------------------------------------------------

/**
 * Calculate luminance from RGB
 */
float luminance(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

/**
 * Soft threshold for bloom extraction
 * Creates smoother falloff than hard threshold
 */
float softThreshold(float value, float threshold, float softness) {
  float knee = threshold * softness;
  float soft = value - threshold + knee;
  soft = clamp(soft, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 0.00001);
  return max(soft, value - threshold);
}

/**
 * Adjust color saturation
 */
vec3 adjustSaturation(vec3 color, float saturation) {
  float grey = luminance(color);
  return mix(vec3(grey), color, saturation);
}

/**
 * 9-tap Gaussian blur kernel
 * Optimized for quality/performance balance
 */
vec3 gaussianBlur(sampler2D tex, vec2 uv, vec2 direction) {
  vec3 color = vec3(0.0);
  vec2 offset = direction * (1.0 / vec2(textureSize(tex, 0)));

  // Gaussian weights for 9-tap kernel
  const float weights[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

  // Center sample
  color += texture2D(tex, uv).rgb * weights[0];

  // Neighboring samples
  for (int i = 1; i < 5; i++) {
    vec2 off = offset * float(i) * uGlowRadius;
    color += texture2D(tex, uv + off).rgb * weights[i];
    color += texture2D(tex, uv - off).rgb * weights[i];
  }

  return color;
}

/**
 * Dual Kawase blur - efficient alternative to Gaussian
 * Better performance for large blur radii
 */
vec3 kawaseBlur(sampler2D tex, vec2 uv, float radius) {
  vec2 texelSize = 1.0 / vec2(textureSize(tex, 0));
  vec2 halfTexel = texelSize * 0.5;

  // Apply anamorphic stretch if enabled
  vec2 blurOffset = texelSize * radius;
  if (uAnamorphic) {
    blurOffset.x *= uAnamorphicRatio;
    blurOffset.y *= 0.5;
  }

  vec3 color = vec3(0.0);

  // 4-tap pattern for Kawase blur
  color += texture2D(tex, uv + vec2(-halfTexel.x - blurOffset.x, halfTexel.y + blurOffset.y)).rgb;
  color += texture2D(tex, uv + vec2(halfTexel.x + blurOffset.x, halfTexel.y + blurOffset.y)).rgb;
  color += texture2D(tex, uv + vec2(halfTexel.x + blurOffset.x, -halfTexel.y - blurOffset.y)).rgb;
  color += texture2D(tex, uv + vec2(-halfTexel.x - blurOffset.x, -halfTexel.y - blurOffset.y)).rgb;

  return color * 0.25;
}

/**
 * State-based glow modulation
 */
float getStateGlowMultiplier() {
  if (uState < 0.5) {
    // Idle - subtle pulsing
    return 0.8 + sin(uTime * 1.5) * 0.1;
  } else if (uState < 1.5) {
    // Listening - steady glow
    return 1.0;
  } else if (uState < 2.5) {
    // Thinking - rapid pulsing
    return 1.2 + sin(uTime * 6.0) * 0.3;
  } else if (uState < 3.5) {
    // Speaking - moderate pulsing
    return 1.1 + sin(uTime * 3.0) * 0.2;
  } else {
    // Error - harsh pulsing
    return 1.5 + sin(uTime * 8.0) * 0.4;
  }
}

//-----------------------------------------------------------------------------
// Main Fragment Shader
//-----------------------------------------------------------------------------

void main() {
  // Sample the input texture
  vec4 inputColor = texture2D(tDiffuse, vUv);

  // Extract brightness for bloom
  float brightness = luminance(inputColor.rgb);
  float bloomMask = softThreshold(brightness, uGlowThreshold, uGlowSoftness);

  // Multi-pass blur for smooth glow
  vec3 blur1 = kawaseBlur(tDiffuse, vUv, uGlowRadius * 0.5);
  vec3 blur2 = kawaseBlur(tDiffuse, vUv, uGlowRadius * 1.0);
  vec3 blur3 = kawaseBlur(tDiffuse, vUv, uGlowRadius * 2.0);
  vec3 blur4 = kawaseBlur(tDiffuse, vUv, uGlowRadius * 4.0);

  // Combine blur passes with decreasing weights
  vec3 combinedBlur = blur1 * 0.4 + blur2 * 0.3 + blur3 * 0.2 + blur4 * 0.1;

  // Apply threshold to blurred result
  vec3 glowColor = combinedBlur * bloomMask;

  // Apply glow tint and saturation
  glowColor = mix(glowColor, glowColor * uGlowColor, 0.5);
  glowColor = adjustSaturation(glowColor, uGlowSaturation);

  // State-based modulation
  float stateMultiplier = getStateGlowMultiplier();
  glowColor *= stateMultiplier;

  // Combine original with glow (additive blend)
  vec3 finalColor = inputColor.rgb + glowColor * uGlowStrength;

  // Soft tone mapping to prevent clipping
  finalColor = finalColor / (finalColor + vec3(1.0));

  gl_FragColor = vec4(finalColor, inputColor.a);
}

#endif

//=============================================================================
// STANDALONE GLOW PASS SHADERS
// These can be used separately for multi-pass rendering
//=============================================================================

//-----------------------------------------------------------------------------
// Brightness Extraction Pass
//-----------------------------------------------------------------------------
#ifdef EXTRACT_BRIGHT

precision highp float;

varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uThreshold;
uniform float uSoftness;

float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec4 color = texture2D(tDiffuse, vUv);
  float lum = luminance(color.rgb);

  // Soft knee threshold
  float knee = uThreshold * uSoftness;
  float soft = lum - uThreshold + knee;
  soft = clamp(soft, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 0.00001);
  float contribution = max(soft, lum - uThreshold) / max(lum, 0.00001);

  gl_FragColor = vec4(color.rgb * contribution, color.a);
}

#endif

//-----------------------------------------------------------------------------
// Horizontal Blur Pass
//-----------------------------------------------------------------------------
#ifdef BLUR_H

precision highp float;

varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uRadius;
uniform bool uAnamorphic;
uniform float uAnamorphicRatio;

void main() {
  vec2 texelSize = 1.0 / vec2(textureSize(tDiffuse, 0));
  float blurRadius = uRadius;
  if (uAnamorphic) {
    blurRadius *= uAnamorphicRatio;
  }

  const float weights[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

  vec3 color = texture2D(tDiffuse, vUv).rgb * weights[0];

  for (int i = 1; i < 5; i++) {
    float offset = float(i) * blurRadius * texelSize.x;
    color += texture2D(tDiffuse, vUv + vec2(offset, 0.0)).rgb * weights[i];
    color += texture2D(tDiffuse, vUv - vec2(offset, 0.0)).rgb * weights[i];
  }

  gl_FragColor = vec4(color, 1.0);
}

#endif

//-----------------------------------------------------------------------------
// Vertical Blur Pass
//-----------------------------------------------------------------------------
#ifdef BLUR_V

precision highp float;

varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uRadius;
uniform bool uAnamorphic;

void main() {
  vec2 texelSize = 1.0 / vec2(textureSize(tDiffuse, 0));
  float blurRadius = uRadius;
  if (uAnamorphic) {
    blurRadius *= 0.5; // Reduced vertical blur for anamorphic
  }

  const float weights[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

  vec3 color = texture2D(tDiffuse, vUv).rgb * weights[0];

  for (int i = 1; i < 5; i++) {
    float offset = float(i) * blurRadius * texelSize.y;
    color += texture2D(tDiffuse, vUv + vec2(0.0, offset)).rgb * weights[i];
    color += texture2D(tDiffuse, vUv - vec2(0.0, offset)).rgb * weights[i];
  }

  gl_FragColor = vec4(color, 1.0);
}

#endif

//-----------------------------------------------------------------------------
// Final Composite Pass
//-----------------------------------------------------------------------------
#ifdef COMPOSITE

precision highp float;

varying vec2 vUv;
uniform sampler2D tDiffuse;    // Original scene
uniform sampler2D tBloom;       // Blurred bright areas
uniform float uStrength;
uniform vec3 uTint;
uniform float uSaturation;

float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 adjustSaturation(vec3 color, float sat) {
  float grey = luminance(color);
  return mix(vec3(grey), color, sat);
}

void main() {
  vec4 original = texture2D(tDiffuse, vUv);
  vec3 bloom = texture2D(tBloom, vUv).rgb;

  // Apply tint and saturation to bloom
  bloom = mix(bloom, bloom * uTint, 0.5);
  bloom = adjustSaturation(bloom, uSaturation);

  // Additive blend
  vec3 finalColor = original.rgb + bloom * uStrength;

  // Reinhard tone mapping
  finalColor = finalColor / (finalColor + vec3(1.0));

  gl_FragColor = vec4(finalColor, original.a);
}

#endif
