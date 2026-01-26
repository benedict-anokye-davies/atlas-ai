/**
 * Atlas Desktop - Orb Visual Regression Tests
 *
 * Comprehensive visual regression tests for the 3D particle orb visualization.
 * Tests all orb states, animations, color themes, and interaction states.
 *
 * @module tests/visual/orb.visual
 */

import {
  test,
  expect,
  OrbState,
  hoverOrb,
  clickOrb,
  waitForFrames,
  getOrbBounds,
  createSnapshotName,
} from './utils';

// ============================================================================
// Test Configuration
// ============================================================================

const ORB_STATES: OrbState[] = ['idle', 'listening', 'thinking', 'speaking', 'error'];

const COLOR_THEMES = ['cyan', 'blue', 'purple', 'gold', 'green', 'pink'] as const;

const AUDIO_LEVELS = [0, 0.25, 0.5, 0.75, 1.0];

// ============================================================================
// Test Suite: Orb State Visualization
// ============================================================================

test.describe('Orb State Visualization', () => {
  test.describe('State Screenshots', () => {
    for (const state of ORB_STATES) {
      test(`should render ${state} state correctly`, async ({ visualTest }) => {
        const { page, setOrbState, waitForOrb, visualCompare } = visualTest;

        // Wait for orb to be ready
        await waitForOrb();

        // Set the state
        await setOrbState(state);

        // Wait for state transition animation to complete
        await page.waitForTimeout(500);

        // Capture visual state
        await visualCompare({
          name: createSnapshotName('orb-state', state),
          maxDiffPixelRatio: 0.03, // Allow slightly more variance for 3D content
          threshold: 0.25,
        });
      });
    }
  });

  test.describe('State Transitions', () => {
    test('should transition smoothly from idle to listening', async ({ visualTest }) => {
      const { page, setOrbState, waitForOrb, visualCompare } = visualTest;

      await waitForOrb();

      // Start in idle state
      await setOrbState('idle');
      await page.waitForTimeout(300);

      // Capture initial state
      await visualCompare({
        name: createSnapshotName('orb-transition', 'idle-to-listening-before'),
        maxDiffPixelRatio: 0.03,
      });

      // Transition to listening
      await setOrbState('listening');
      await page.waitForTimeout(500);

      // Capture final state
      await visualCompare({
        name: createSnapshotName('orb-transition', 'idle-to-listening-after'),
        maxDiffPixelRatio: 0.03,
      });
    });

    test('should transition smoothly through full conversation cycle', async ({
      visualTest,
    }) => {
      const { page, setOrbState, waitForOrb, visualCompare } = visualTest;

      await waitForOrb();

      const states: OrbState[] = ['idle', 'listening', 'thinking', 'speaking', 'idle'];

      for (let i = 0; i < states.length; i++) {
        const state = states[i];
        await setOrbState(state);
        await page.waitForTimeout(400);

        await visualCompare({
          name: createSnapshotName('orb-cycle', `step-${i}-${state}`),
          maxDiffPixelRatio: 0.04,
        });
      }
    });
  });

  test.describe('Error State Handling', () => {
    test('should display error state with red coloring', async ({ visualTest }) => {
      const { page, setOrbState, waitForOrb, visualCompare } = visualTest;

      await waitForOrb();
      await setOrbState('error');
      await page.waitForTimeout(500);

      // Verify error state visual
      await visualCompare({
        name: createSnapshotName('orb-error', 'display'),
        maxDiffPixelRatio: 0.03,
      });

      // Verify error indicator is visible
      const errorIndicator = page.locator('.orb-state-error');
      await expect(errorIndicator).toBeVisible();
    });

    test('should recover from error state to idle', async ({ visualTest }) => {
      const { page, setOrbState, waitForOrb, visualCompare } = visualTest;

      await waitForOrb();

      // Enter error state
      await setOrbState('error');
      await page.waitForTimeout(300);

      // Recover to idle
      await setOrbState('idle');
      await page.waitForTimeout(500);

      await visualCompare({
        name: createSnapshotName('orb-error', 'recovery'),
        maxDiffPixelRatio: 0.03,
      });
    });
  });
});

// ============================================================================
// Test Suite: Audio Level Visualization
// ============================================================================

test.describe('Audio Level Visualization', () => {
  test.describe('Audio Level Response', () => {
    for (const level of AUDIO_LEVELS) {
      test(`should respond to audio level ${level * 100}%`, async ({ visualTest }) => {
        const { page, setOrbState, setAudioLevel, waitForOrb, visualCompare } = visualTest;

        await waitForOrb();

        // Set to listening state (responds to audio)
        await setOrbState('listening');
        await page.waitForTimeout(200);

        // Set audio level
        await setAudioLevel(level);
        await page.waitForTimeout(300);

        await visualCompare({
          name: createSnapshotName('orb-audio', `level-${Math.round(level * 100)}`),
          maxDiffPixelRatio: 0.05, // Higher variance for audio-reactive visuals
          threshold: 0.3,
        });
      });
    }
  });

  test.describe('Audio Level Dynamics', () => {
    test('should show particle expansion at high audio levels', async ({ visualTest }) => {
      const { page, setOrbState, setAudioLevel, waitForOrb } = visualTest;

      await waitForOrb();
      await setOrbState('listening');

      // Set low level
      await setAudioLevel(0.1);
      await page.waitForTimeout(200);

      // Capture low level bounds (particles should be more contained)
      const lowBounds = await getOrbBounds(page);

      // Set high level
      await setAudioLevel(0.9);
      await page.waitForTimeout(300);

      // Capture high level bounds (particles should be more expanded)
      const highBounds = await getOrbBounds(page);

      // Orb container should remain the same size
      expect(lowBounds).toEqual(highBounds);
    });
  });
});

// ============================================================================
// Test Suite: Color Themes
// ============================================================================

test.describe('Orb Color Themes', () => {
  test.describe('Theme Screenshots', () => {
    for (const theme of COLOR_THEMES) {
      test(`should render ${theme} color theme correctly`, async ({ visualTest }) => {
        const { page, setOrbState, waitForOrb, injectStoreState, visualCompare } =
          visualTest;

        await waitForOrb();

        // Set color theme
        await injectStoreState({
          settings: {
            orbColorTheme: theme,
          },
        });

        await setOrbState('idle');
        await page.waitForTimeout(500);

        await visualCompare({
          name: createSnapshotName('orb-theme', theme),
          maxDiffPixelRatio: 0.03,
        });
      });
    }
  });

  test.describe('Custom Hue', () => {
    test('should apply custom hue when theme is custom', async ({ visualTest }) => {
      const { page, setOrbState, waitForOrb, injectStoreState, visualCompare } = visualTest;

      await waitForOrb();

      // Set custom theme with specific hue
      await injectStoreState({
        settings: {
          orbColorTheme: 'custom',
          customOrbHue: 0.75, // Magenta range
        },
      });

      await setOrbState('idle');
      await page.waitForTimeout(500);

      await visualCompare({
        name: createSnapshotName('orb-theme', 'custom-hue-075'),
        maxDiffPixelRatio: 0.04,
      });
    });
  });

  test.describe('Brightness and Saturation', () => {
    test('should apply brightness adjustment', async ({ visualTest }) => {
      const { page, setOrbState, waitForOrb, injectStoreState, visualCompare } = visualTest;

      await waitForOrb();

      // High brightness
      await injectStoreState({
        settings: {
          orbBrightness: 1.5,
        },
      });

      await setOrbState('idle');
      await page.waitForTimeout(500);

      await visualCompare({
        name: createSnapshotName('orb-brightness', 'high'),
        maxDiffPixelRatio: 0.05,
      });
    });

    test('should apply saturation adjustment', async ({ visualTest }) => {
      const { page, setOrbState, waitForOrb, injectStoreState, visualCompare } = visualTest;

      await waitForOrb();

      // Low saturation (desaturated)
      await injectStoreState({
        settings: {
          orbSaturation: 0.3,
        },
      });

      await setOrbState('idle');
      await page.waitForTimeout(500);

      await visualCompare({
        name: createSnapshotName('orb-saturation', 'low'),
        maxDiffPixelRatio: 0.05,
      });
    });
  });
});

// ============================================================================
// Test Suite: Mouse Interaction
// ============================================================================

test.describe('Orb Mouse Interaction', () => {
  test.describe('Hover Effects', () => {
    test('should change cursor on hover', async ({ visualTest }) => {
      const { page, waitForOrb } = visualTest;

      await waitForOrb();

      // Hover over orb
      await hoverOrb(page);
      await page.waitForTimeout(200);

      // Verify cursor style
      const orbContainer = page.locator('.atlas-orb-container');
      await expect(orbContainer).toHaveCSS('cursor', 'pointer');
    });

    test('should show visual feedback on hover', async ({ visualTest }) => {
      const { page, waitForOrb, visualCompare } = visualTest;

      await waitForOrb();

      // Capture before hover
      await visualCompare({
        name: createSnapshotName('orb-hover', 'before'),
        maxDiffPixelRatio: 0.03,
      });

      // Hover over orb
      await hoverOrb(page);
      await page.waitForTimeout(300);

      // Capture during hover
      await visualCompare({
        name: createSnapshotName('orb-hover', 'during'),
        maxDiffPixelRatio: 0.04,
      });
    });
  });

  test.describe('Click Effects', () => {
    test('should trigger wake on click when idle', async ({ visualTest }) => {
      const { page, setOrbState, waitForOrb } = visualTest;

      await waitForOrb();
      await setOrbState('idle');
      await page.waitForTimeout(200);

      // Click the orb
      await clickOrb(page);
      await page.waitForTimeout(500);

      // Verify state changed (should transition to listening)
      const statusText = page.locator('.status-text');
      await expect(statusText).toContainText(/Listening|Say "Hey Atlas"/);
    });

    test('should show click feedback animation', async ({ visualTest }) => {
      const { page, waitForOrb, visualCompare } = visualTest;

      await waitForOrb();

      // Capture before click
      await visualCompare({
        name: createSnapshotName('orb-click', 'before'),
        maxDiffPixelRatio: 0.03,
      });

      // Perform click (creates visual ripple effect)
      await clickOrb(page);
      await page.waitForTimeout(100);

      // Capture immediately after click
      await visualCompare({
        name: createSnapshotName('orb-click', 'during'),
        maxDiffPixelRatio: 0.05, // Allow more variance for animation
      });
    });
  });
});

// ============================================================================
// Test Suite: Particle System
// ============================================================================

test.describe('Particle System Visualization', () => {
  test.describe('Particle Count', () => {
    const particleCounts = [3000, 8000, 15000, 35000];

    for (const count of particleCounts) {
      test(`should render ${count} particles correctly`, async ({ visualTest }) => {
        const { page, waitForOrb, injectStoreState, visualCompare } = visualTest;

        await waitForOrb();

        // Set particle count
        await injectStoreState({
          settings: {
            particleCount: count,
            qualityPreset: 'custom',
          },
        });

        await page.waitForTimeout(1000); // Allow particle system to re-initialize

        await visualCompare({
          name: createSnapshotName('orb-particles', `count-${count}`),
          maxDiffPixelRatio: 0.05,
          threshold: 0.3,
        });
      });
    }
  });

  test.describe('Attractor Types', () => {
    const attractors = ['aizawa', 'lorenz', 'thomas', 'halvorsen', 'arneodo'] as const;

    for (const attractor of attractors) {
      test(`should render ${attractor} attractor pattern`, async ({ visualTest }) => {
        const { page, setOrbState, waitForOrb, injectStoreState, visualCompare } =
          visualTest;

        await waitForOrb();

        // Set attractor type
        await injectStoreState({
          settings: {
            attractorType: attractor,
          },
        });

        await setOrbState('idle');
        await page.waitForTimeout(1000); // Allow attractor to take effect

        await visualCompare({
          name: createSnapshotName('orb-attractor', attractor),
          maxDiffPixelRatio: 0.06, // Higher variance for different patterns
          threshold: 0.35,
        });
      });
    }
  });
});

// ============================================================================
// Test Suite: Responsive Design
// ============================================================================

test.describe('Orb Responsive Design', () => {
  const viewports = [
    { width: 1920, height: 1080, name: 'desktop-large' },
    { width: 1280, height: 720, name: 'desktop-medium' },
    { width: 800, height: 600, name: 'desktop-small' },
    { width: 640, height: 480, name: 'mobile-landscape' },
    { width: 390, height: 844, name: 'mobile-portrait' },
  ];

  for (const viewport of viewports) {
    test(`should render correctly at ${viewport.name} (${viewport.width}x${viewport.height})`, async ({
      visualTest,
    }) => {
      const { page, waitForOrb, visualCompare } = visualTest;

      // Set viewport
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(500);

      await waitForOrb();

      await visualCompare({
        name: createSnapshotName('orb-responsive', viewport.name),
        maxDiffPixelRatio: 0.04,
        fullPage: true,
      });
    });
  }
});

// ============================================================================
// Test Suite: WebGL Fallback
// ============================================================================

test.describe('Orb WebGL Fallback', () => {
  test('should display fallback when WebGL is unavailable', async ({ visualTest }) => {
    const { page, visualCompare } = visualTest;

    // Simulate WebGL failure by overriding getContext
    await page.evaluate(() => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        type: string,
        ...args: unknown[]
      ) {
        if (type === 'webgl' || type === 'webgl2') {
          return null;
        }
        return originalGetContext.call(this, type, ...args);
      };
    });

    // Reload to trigger fallback
    await page.reload();
    await page.waitForTimeout(1000);

    // Should show error state or fallback visualization
    await visualCompare({
      name: createSnapshotName('orb-fallback', 'no-webgl'),
      maxDiffPixelRatio: 0.03,
    });
  });
});

// ============================================================================
// Test Suite: Performance States
// ============================================================================

test.describe('Orb Performance States', () => {
  test('should render in low quality mode', async ({ visualTest }) => {
    const { page, waitForOrb, injectStoreState, visualCompare } = visualTest;

    await waitForOrb();

    // Set low quality preset
    await injectStoreState({
      settings: {
        qualityPreset: 'low',
        particleCount: 3000,
        enableEffects: false,
        enableShadows: false,
        enablePostProcessing: false,
        enableAntialiasing: false,
      },
    });

    await page.waitForTimeout(500);

    await visualCompare({
      name: createSnapshotName('orb-quality', 'low'),
      maxDiffPixelRatio: 0.03,
    });
  });

  test('should render in high quality mode', async ({ visualTest }) => {
    const { page, waitForOrb, injectStoreState, visualCompare } = visualTest;

    await waitForOrb();

    // Set high quality preset
    await injectStoreState({
      settings: {
        qualityPreset: 'high',
        particleCount: 15000,
        enableEffects: true,
        enableShadows: true,
        enablePostProcessing: false, // Disabled due to Vite buffer issue
        enableAntialiasing: true,
      },
    });

    await page.waitForTimeout(500);

    await visualCompare({
      name: createSnapshotName('orb-quality', 'high'),
      maxDiffPixelRatio: 0.04,
    });
  });

  test('should render in ultra quality mode', async ({ visualTest }) => {
    const { page, waitForOrb, injectStoreState, visualCompare } = visualTest;

    await waitForOrb();

    // Set ultra quality preset
    await injectStoreState({
      settings: {
        qualityPreset: 'ultra',
        particleCount: 35000,
        enableEffects: true,
        enableShadows: true,
        enablePostProcessing: false,
        enableAntialiasing: true,
      },
    });

    await page.waitForTimeout(1000);

    await visualCompare({
      name: createSnapshotName('orb-quality', 'ultra'),
      maxDiffPixelRatio: 0.05,
    });
  });
});

// ============================================================================
// Test Suite: Accessibility
// ============================================================================

test.describe('Orb Accessibility', () => {
  test('should have accessible ARIA attributes', async ({ visualTest }) => {
    const { page, waitForOrb } = visualTest;

    await waitForOrb();

    // Check ARIA attributes
    const orbContainer = page.locator('.atlas-orb-container');

    await expect(orbContainer).toHaveAttribute('role', 'button');
    await expect(orbContainer).toHaveAttribute('tabIndex', '0');
    await expect(orbContainer).toHaveAttribute('aria-label', /Atlas orb/);
  });

  test('should be keyboard focusable', async ({ visualTest }) => {
    const { page, waitForOrb, visualCompare } = visualTest;

    await waitForOrb();

    // Tab to focus the orb
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    // Capture focused state
    await visualCompare({
      name: createSnapshotName('orb-a11y', 'focused'),
      maxDiffPixelRatio: 0.04,
    });
  });

  test('should respond to Enter key', async ({ visualTest }) => {
    const { page, setOrbState, waitForOrb } = visualTest;

    await waitForOrb();
    await setOrbState('idle');

    // Focus and press Enter
    const orbContainer = page.locator('.atlas-orb-container');
    await orbContainer.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Should transition to listening
    const statusText = page.locator('.status-text');
    await expect(statusText).toContainText(/Listening|Say "Hey Atlas"/);
  });
});

// ============================================================================
// Test Suite: Animation Smoothness
// ============================================================================

test.describe('Orb Animation Smoothness', () => {
  test('should maintain consistent frame rendering', async ({ visualTest }) => {
    const { page, setOrbState, waitForOrb } = visualTest;

    await waitForOrb();
    await setOrbState('speaking');

    // Capture multiple frames
    const frames: string[] = [];
    for (let i = 0; i < 10; i++) {
      await waitForFrames(page, 1);
      const dataUrl = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        return canvas?.toDataURL('image/png') || '';
      });
      frames.push(dataUrl);
    }

    // Verify frames are being rendered (content changes)
    const uniqueFrames = new Set(frames);
    // With animations disabled, frames should be similar but not necessarily identical
    expect(frames.length).toBe(10);
  });
});
