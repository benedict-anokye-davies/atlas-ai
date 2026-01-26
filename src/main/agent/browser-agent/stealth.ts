/**
 * Stealth Mode
 *
 * Anti-detection and human-like behavior simulation for browser automation.
 * Helps avoid bot detection systems like Cloudflare, DataDome, and PerimeterX.
 *
 * @module agent/browser-agent/stealth
 */

import { createModuleLogger } from '../../utils/logger';
import { StealthConfig, FingerprintConfig, DEFAULT_STEALTH_CONFIG } from './types';

const logger = createModuleLogger('StealthMode');

// ============================================================================
// Stealth Scripts
// ============================================================================

/**
 * Script to patch navigator properties
 */
const NAVIGATOR_PATCH_SCRIPT = `
(() => {
  // Override webdriver detection
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
  });
  
  // Override plugins to look more realistic
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const plugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ];
      
      const pluginArray = Object.create(PluginArray.prototype);
      plugins.forEach((p, i) => {
        const plugin = Object.create(Plugin.prototype);
        Object.defineProperties(plugin, {
          name: { value: p.name },
          filename: { value: p.filename },
          description: { value: p.description },
          length: { value: 0 },
        });
        pluginArray[i] = plugin;
      });
      
      Object.defineProperty(pluginArray, 'length', { value: plugins.length });
      pluginArray.item = (i) => pluginArray[i];
      pluginArray.namedItem = (name) => plugins.find(p => p.name === name);
      pluginArray.refresh = () => {};
      
      return pluginArray;
    },
    configurable: true,
  });
  
  // Override languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
    configurable: true,
  });
  
  // Override platform
  Object.defineProperty(navigator, 'platform', {
    get: () => 'Win32',
    configurable: true,
  });
  
  // Override hardware concurrency
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => 8,
    configurable: true,
  });
  
  // Override device memory
  Object.defineProperty(navigator, 'deviceMemory', {
    get: () => 8,
    configurable: true,
  });
  
  // Override connection
  if (navigator.connection) {
    Object.defineProperty(navigator.connection, 'rtt', { get: () => 50 });
    Object.defineProperty(navigator.connection, 'downlink', { get: () => 10 });
    Object.defineProperty(navigator.connection, 'effectiveType', { get: () => '4g' });
  }
})();
`;

/**
 * Script to add canvas noise for fingerprinting protection
 */
const CANVAS_NOISE_SCRIPT = `
(() => {
  const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
  const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  
  // Add subtle noise to canvas
  function addNoise(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Add very subtle noise (imperceptible to humans)
    for (let i = 0; i < data.length; i += 4) {
      // Only modify every ~100th pixel with tiny changes
      if (Math.random() < 0.01) {
        data[i] = Math.max(0, Math.min(255, data[i] + (Math.random() * 2 - 1)));
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
  }
  
  HTMLCanvasElement.prototype.toDataURL = function(...args) {
    if (this.width > 0 && this.height > 0) {
      addNoise(this);
    }
    return originalToDataURL.apply(this, args);
  };
})();
`;

/**
 * Script to add WebGL noise
 */
const WEBGL_NOISE_SCRIPT = `
(() => {
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  
  WebGLRenderingContext.prototype.getParameter = function(parameter) {
    // Add slight variations to some parameters
    if (parameter === 37445) { // UNMASKED_VENDOR_WEBGL
      return 'Intel Inc.';
    }
    if (parameter === 37446) { // UNMASKED_RENDERER_WEBGL
      return 'Intel Iris OpenGL Engine';
    }
    return getParameter.apply(this, arguments);
  };
  
  // Also patch WebGL2
  if (typeof WebGL2RenderingContext !== 'undefined') {
    const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter2.apply(this, arguments);
    };
  }
})();
`;

/**
 * Script to add AudioContext noise
 */
const AUDIO_NOISE_SCRIPT = `
(() => {
  const originalCreateAnalyser = AudioContext.prototype.createAnalyser;
  
  AudioContext.prototype.createAnalyser = function() {
    const analyser = originalCreateAnalyser.apply(this, arguments);
    const originalGetFloatFrequencyData = analyser.getFloatFrequencyData.bind(analyser);
    
    analyser.getFloatFrequencyData = function(array) {
      originalGetFloatFrequencyData(array);
      // Add tiny noise
      for (let i = 0; i < array.length; i++) {
        array[i] += (Math.random() * 0.0001 - 0.00005);
      }
    };
    
    return analyser;
  };
})();
`;

/**
 * Script to handle permission queries realistically
 */
const PERMISSIONS_SCRIPT = `
(() => {
  const originalQuery = navigator.permissions.query;
  
  navigator.permissions.query = function(parameters) {
    return originalQuery.apply(this, arguments).then(result => {
      // Make notifications permission look granted (common for regular users)
      if (parameters.name === 'notifications') {
        Object.defineProperty(result, 'state', { value: 'prompt' });
      }
      return result;
    });
  };
})();
`;

/**
 * Script to override screen properties
 */
const SCREEN_OVERRIDE_SCRIPT = (width: number, height: number) => `
(() => {
  Object.defineProperty(screen, 'width', { get: () => ${width} });
  Object.defineProperty(screen, 'height', { get: () => ${height} });
  Object.defineProperty(screen, 'availWidth', { get: () => ${width} });
  Object.defineProperty(screen, 'availHeight', { get: () => ${height - 40} });
  Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
  Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });
})();
`;

/**
 * Script to override timezone
 */
const TIMEZONE_OVERRIDE_SCRIPT = (timezone: string) => `
(() => {
  const originalDateTimeFormat = Intl.DateTimeFormat;
  
  Intl.DateTimeFormat = function(locale, options) {
    if (!options) options = {};
    options.timeZone = '${timezone}';
    return new originalDateTimeFormat(locale, options);
  };
  
  Intl.DateTimeFormat.prototype = originalDateTimeFormat.prototype;
  Intl.DateTimeFormat.supportedLocalesOf = originalDateTimeFormat.supportedLocalesOf;
  
  // Also override Date methods
  const originalGetTimezoneOffset = Date.prototype.getTimezoneOffset;
  Date.prototype.getTimezoneOffset = function() {
    // Return offset for the specified timezone
    // This is a simplified version - real implementation would need timezone database
    return 0; // UTC for now
  };
})();
`;

// ============================================================================
// Human-like Behavior Utilities
// ============================================================================

/**
 * Generate a human-like mouse path using Bezier curves
 */
export function generateHumanMousePath(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  steps = 20
): Array<{ x: number; y: number; delay: number }> {
  const path: Array<{ x: number; y: number; delay: number }> = [];
  
  // Add some random control points for natural movement
  const controlX1 = startX + (endX - startX) * 0.3 + (Math.random() - 0.5) * 100;
  const controlY1 = startY + (endY - startY) * 0.3 + (Math.random() - 0.5) * 100;
  const controlX2 = startX + (endX - startX) * 0.7 + (Math.random() - 0.5) * 100;
  const controlY2 = startY + (endY - startY) * 0.7 + (Math.random() - 0.5) * 100;
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    
    // Cubic Bezier curve
    const x =
      Math.pow(1 - t, 3) * startX +
      3 * Math.pow(1 - t, 2) * t * controlX1 +
      3 * (1 - t) * Math.pow(t, 2) * controlX2 +
      Math.pow(t, 3) * endX;
    
    const y =
      Math.pow(1 - t, 3) * startY +
      3 * Math.pow(1 - t, 2) * t * controlY1 +
      3 * (1 - t) * Math.pow(t, 2) * controlY2 +
      Math.pow(t, 3) * endY;
    
    // Variable delay - slower at start and end, faster in middle
    const speedFactor = 4 * t * (1 - t); // Parabola peaking at t=0.5
    const baseDelay = 10;
    const variableDelay = baseDelay + (1 - speedFactor) * 20;
    const delay = variableDelay + Math.random() * 10;
    
    path.push({
      x: Math.round(x),
      y: Math.round(y),
      delay: Math.round(delay),
    });
  }
  
  return path;
}

/**
 * Generate human-like typing delays
 */
export function generateTypingDelays(text: string): number[] {
  const delays: number[] = [];
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    let baseDelay = 50 + Math.random() * 100; // 50-150ms base
    
    // Slower for uppercase (shift key)
    if (char === char.toUpperCase() && char !== char.toLowerCase()) {
      baseDelay += 30;
    }
    
    // Slower for special characters
    if (/[^a-zA-Z0-9\s]/.test(char)) {
      baseDelay += 50;
    }
    
    // Occasional longer pauses (thinking)
    if (Math.random() < 0.05) {
      baseDelay += 200 + Math.random() * 300;
    }
    
    // Slightly faster for repeated characters
    if (i > 0 && text[i] === text[i - 1]) {
      baseDelay *= 0.7;
    }
    
    delays.push(Math.round(baseDelay));
  }
  
  return delays;
}

/**
 * Generate random scroll pattern
 */
export function generateScrollPattern(
  totalDistance: number,
  direction: 'up' | 'down' = 'down'
): Array<{ delta: number; delay: number }> {
  const pattern: Array<{ delta: number; delay: number }> = [];
  let remaining = Math.abs(totalDistance);
  const sign = direction === 'down' ? 1 : -1;
  
  while (remaining > 0) {
    // Variable scroll amounts
    const amount = Math.min(remaining, 50 + Math.random() * 150);
    remaining -= amount;
    
    pattern.push({
      delta: Math.round(amount * sign),
      delay: 30 + Math.random() * 70,
    });
    
    // Occasional pause during scrolling
    if (Math.random() < 0.1) {
      pattern.push({
        delta: 0,
        delay: 200 + Math.random() * 500,
      });
    }
  }
  
  return pattern;
}

// ============================================================================
// Stealth Mode Manager
// ============================================================================

export class StealthModeManager {
  private page: any;
  private config: StealthConfig;
  private isApplied = false;

  constructor(page: any, config?: Partial<StealthConfig>) {
    this.page = page;
    this.config = { ...DEFAULT_STEALTH_CONFIG, ...config };
  }

  /**
   * Apply stealth mode to the page
   */
  async apply(): Promise<void> {
    if (!this.config.enabled || this.isApplied) return;
    
    logger.info('Applying stealth mode');
    
    // Apply navigator patches
    if (this.config.fingerprintProtection.navigatorOverrides) {
      await this.page.evaluateOnNewDocument(NAVIGATOR_PATCH_SCRIPT);
    }
    
    // Apply canvas noise
    if (this.config.fingerprintProtection.canvasNoise) {
      await this.page.evaluateOnNewDocument(CANVAS_NOISE_SCRIPT);
    }
    
    // Apply WebGL noise
    if (this.config.fingerprintProtection.webglNoise) {
      await this.page.evaluateOnNewDocument(WEBGL_NOISE_SCRIPT);
    }
    
    // Apply audio noise
    if (this.config.fingerprintProtection.audioNoise) {
      await this.page.evaluateOnNewDocument(AUDIO_NOISE_SCRIPT);
    }
    
    // Apply permissions handling
    await this.page.evaluateOnNewDocument(PERMISSIONS_SCRIPT);
    
    // Apply screen overrides if specified
    if (this.config.fingerprintProtection.screenOverrides) {
      await this.page.evaluateOnNewDocument(SCREEN_OVERRIDE_SCRIPT(1920, 1080));
    }
    
    // Apply timezone override if specified
    if (this.config.fingerprintProtection.timezoneOverride) {
      await this.page.evaluateOnNewDocument(
        TIMEZONE_OVERRIDE_SCRIPT(this.config.fingerprintProtection.timezoneOverride)
      );
    }
    
    this.isApplied = true;
    logger.debug('Stealth mode applied');
  }

  /**
   * Move mouse with human-like behavior
   */
  async humanMove(targetX: number, targetY: number): Promise<void> {
    if (!this.config.humanMouseMovements) {
      await this.page.mouse.move(targetX, targetY);
      return;
    }
    
    // Get current position (approximate)
    const viewport = await this.page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    
    // Start from a random edge position if we don't know current position
    const startX = Math.random() * viewport.width;
    const startY = Math.random() * viewport.height;
    
    const path = generateHumanMousePath(startX, startY, targetX, targetY);
    
    for (const point of path) {
      await this.page.mouse.move(point.x, point.y);
      await this.delay(point.delay);
    }
  }

  /**
   * Click with human-like behavior
   */
  async humanClick(x: number, y: number, button: 'left' | 'right' = 'left'): Promise<void> {
    // Move to target first
    if (this.config.humanMouseMovements) {
      await this.humanMove(x, y);
    } else {
      await this.page.mouse.move(x, y);
    }
    
    // Small pause before clicking
    await this.delay(50 + Math.random() * 100);
    
    // Click with slight position variation
    const clickX = x + (Math.random() * 4 - 2);
    const clickY = y + (Math.random() * 4 - 2);
    
    await this.page.mouse.click(clickX, clickY, { button });
    
    // Small pause after clicking
    await this.delay(50 + Math.random() * 100);
  }

  /**
   * Type with human-like behavior
   */
  async humanType(text: string): Promise<void> {
    const delays = generateTypingDelays(text);
    
    for (let i = 0; i < text.length; i++) {
      await this.page.keyboard.type(text[i]);
      await this.delay(delays[i]);
    }
  }

  /**
   * Scroll with human-like behavior
   */
  async humanScroll(delta: number, direction: 'up' | 'down' = 'down'): Promise<void> {
    if (!this.config.naturalScrolling) {
      await this.page.mouse.wheel({ deltaY: delta * (direction === 'up' ? -1 : 1) });
      return;
    }
    
    const pattern = generateScrollPattern(delta, direction);
    
    for (const step of pattern) {
      if (step.delta !== 0) {
        await this.page.mouse.wheel({ deltaY: step.delta });
      }
      await this.delay(step.delay);
    }
  }

  /**
   * Get randomized delay within configured range
   */
  getRandomDelay(): number {
    if (!this.config.randomizeTimings) return 0;
    
    return (
      Math.random() * (this.config.timingRange.max - this.config.timingRange.min) +
      this.config.timingRange.min
    );
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<StealthConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if stealth mode is active
   */
  isActive(): boolean {
    return this.config.enabled && this.isApplied;
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a stealth mode manager for a Puppeteer page
 */
export function createStealthModeManager(
  page: any,
  config?: Partial<StealthConfig>
): StealthModeManager {
  return new StealthModeManager(page, config);
}
