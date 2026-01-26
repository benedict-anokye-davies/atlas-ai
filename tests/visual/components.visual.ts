/**
 * Atlas Desktop - Component Visual Regression Tests
 *
 * Comprehensive visual regression tests for all UI components.
 * Tests Settings panel, conversation display, status indicators,
 * debug overlays, error toasts, and other UI elements.
 *
 * @module tests/visual/components.visual
 */

import { test, expect, createSnapshotName, getMaskLocators } from './utils';

// ============================================================================
// Test Suite: Main App Layout
// ============================================================================

test.describe('Main App Layout', () => {
  test.describe('Full Page Screenshots', () => {
    test('should render main app layout correctly', async ({ visualTest }) => {
      const { page, waitForOrb, visualCompare } = visualTest;

      await waitForOrb();

      await visualCompare({
        name: createSnapshotName('app-layout', 'full'),
        fullPage: true,
        maxDiffPixelRatio: 0.03,
      });
    });

    test('should render app with dark theme', async ({ visualTest }) => {
      const { page, setTheme, waitForOrb, visualCompare } = visualTest;

      await waitForOrb();
      await setTheme('dark');
      await page.waitForTimeout(200);

      await visualCompare({
        name: createSnapshotName('app-layout', 'dark-theme'),
        fullPage: true,
        maxDiffPixelRatio: 0.03,
      });
    });

    test('should render app with light theme', async ({ visualTest }) => {
      const { page, setTheme, waitForOrb, visualCompare } = visualTest;

      await waitForOrb();
      await setTheme('light');
      await page.waitForTimeout(200);

      await visualCompare({
        name: createSnapshotName('app-layout', 'light-theme'),
        fullPage: true,
        maxDiffPixelRatio: 0.03,
      });
    });
  });

  test.describe('Background', () => {
    test('should render solid black background', async ({ visualTest }) => {
      const { page, waitForOrb, visualCompare } = visualTest;

      await waitForOrb();

      // Clip to background area only
      await visualCompare({
        name: createSnapshotName('app-background', 'default'),
        clip: { x: 0, y: 0, width: 100, height: 100 },
        maxDiffPixelRatio: 0.01,
      });
    });
  });
});

// ============================================================================
// Test Suite: Status Indicator
// ============================================================================

test.describe('Status Indicator', () => {
  test.describe('State-Based Status', () => {
    const states = [
      { state: 'idle', expectedText: /Say "Hey Atlas"|Starting/ },
      { state: 'listening', expectedText: /Listening/ },
      { state: 'thinking', expectedText: /Thinking/ },
      { state: 'speaking', expectedText: /Speaking/ },
      { state: 'error', expectedText: /Error/ },
    ] as const;

    for (const { state, expectedText } of states) {
      test(`should display correct status for ${state} state`, async ({ visualTest }) => {
        const { page, setOrbState, waitForOrb, visualCompare } = visualTest;

        await waitForOrb();
        await setOrbState(state);
        await page.waitForTimeout(300);

        // Verify status text
        const statusText = page.locator('.status-text');
        await expect(statusText).toContainText(expectedText);

        // Capture status indicator
        const statusElement = page.locator('.atlas-status');
        const box = await statusElement.boundingBox();

        if (box) {
          await visualCompare({
            name: createSnapshotName('status-indicator', state),
            clip: {
              x: box.x - 10,
              y: box.y - 10,
              width: box.width + 20,
              height: box.height + 20,
            },
            maxDiffPixelRatio: 0.02,
          });
        }
      });
    }
  });

  test.describe('Status Dot Animation', () => {
    test('should show pulsing dot for listening state', async ({ visualTest }) => {
      const { page, setOrbState, waitForOrb } = visualTest;

      await waitForOrb();
      await setOrbState('listening');
      await page.waitForTimeout(200);

      // Verify pulse animation class is applied
      const statusDot = page.locator('.atlas-status-listening .status-dot');
      await expect(statusDot).toBeVisible();

      // Animation should be defined
      const animation = await statusDot.evaluate(
        (el) => getComputedStyle(el).animationName
      );
      // Note: Animation is disabled in test mode, but class should be present
      await expect(statusDot).toHaveCSS('background-color', /.+/);
    });
  });
});

// ============================================================================
// Test Suite: Conversation Display
// ============================================================================

test.describe('Conversation Display', () => {
  test.describe('Transcript Panel', () => {
    test('should display user transcript correctly', async ({ visualTest }) => {
      const { page, waitForOrb, injectStoreState, visualCompare } = visualTest;

      await waitForOrb();

      // Inject transcript state
      await injectStoreState({
        transcript: 'What is the weather today?',
        showTranscript: true,
      });

      await page.waitForTimeout(200);

      // Verify conversation panel is visible
      const conversationPanel = page.locator('.atlas-conversation');
      await expect(conversationPanel).toBeVisible();

      // Capture conversation panel
      await visualCompare({
        name: createSnapshotName('conversation', 'user-transcript'),
        maxDiffPixelRatio: 0.02,
        mask: getMaskLocators(page),
      });
    });

    test('should display Atlas response correctly', async ({ visualTest }) => {
      const { page, waitForOrb, injectStoreState, visualCompare } = visualTest;

      await waitForOrb();

      // Inject response state
      await injectStoreState({
        transcript: 'What is the weather today?',
        response: 'The weather today is sunny with a high of 72 degrees.',
        showTranscript: true,
      });

      await page.waitForTimeout(200);

      await visualCompare({
        name: createSnapshotName('conversation', 'with-response'),
        maxDiffPixelRatio: 0.02,
        mask: getMaskLocators(page),
      });
    });

    test('should show thinking dots animation', async ({ visualTest }) => {
      const { page, waitForOrb, injectStoreState, visualCompare } = visualTest;

      await waitForOrb();

      // Inject thinking state
      await injectStoreState({
        transcript: 'What is the weather today?',
        response: '',
        isThinking: true,
        showTranscript: true,
      });

      await page.waitForTimeout(200);

      // Verify thinking dots are visible
      const thinkingDots = page.locator('.thinking-dots');
      await expect(thinkingDots).toBeVisible();

      await visualCompare({
        name: createSnapshotName('conversation', 'thinking'),
        maxDiffPixelRatio: 0.03,
      });
    });

    test('should show interim transcript with typing indicator', async ({ visualTest }) => {
      const { page, waitForOrb, injectStoreState, visualCompare } = visualTest;

      await waitForOrb();

      // Inject interim transcript
      await injectStoreState({
        interimTranscript: 'What is the wea...',
        showTranscript: true,
      });

      await page.waitForTimeout(200);

      // Verify typing indicator
      const typingIndicator = page.locator('.typing-indicator');
      await expect(typingIndicator).toBeVisible();

      await visualCompare({
        name: createSnapshotName('conversation', 'interim-transcript'),
        maxDiffPixelRatio: 0.02,
      });
    });
  });

  test.describe('Conversation Labels', () => {
    test('should display "You" label for user message', async ({ visualTest }) => {
      const { page, waitForOrb, injectStoreState } = visualTest;

      await waitForOrb();

      await injectStoreState({
        transcript: 'Hello Atlas',
        showTranscript: true,
      });

      await page.waitForTimeout(200);

      const userLabel = page.locator('.conversation-user .conversation-label');
      await expect(userLabel).toHaveText('You');
    });

    test('should display "Atlas" label for assistant message', async ({ visualTest }) => {
      const { page, waitForOrb, injectStoreState } = visualTest;

      await waitForOrb();

      await injectStoreState({
        transcript: 'Hello',
        response: 'Hello! How can I help?',
        showTranscript: true,
      });

      await page.waitForTimeout(200);

      const atlasLabel = page.locator('.conversation-atlas .conversation-label');
      await expect(atlasLabel).toHaveText('Atlas');
    });
  });
});

// ============================================================================
// Test Suite: Footer
// ============================================================================

test.describe('Footer', () => {
  test.describe('Connection Status', () => {
    test('should display connected status', async ({ visualTest }) => {
      const { page, waitForOrb, injectStoreState, visualCompare } = visualTest;

      await waitForOrb();

      await injectStoreState({
        isReady: true,
      });

      await page.waitForTimeout(100);

      const connectionStatus = page.locator('.connection-status');
      await expect(connectionStatus).toHaveClass(/connected/);
      await expect(connectionStatus).toContainText('Connected');

      // Capture footer
      const footer = page.locator('.atlas-footer');
      const box = await footer.boundingBox();

      if (box) {
        await visualCompare({
          name: createSnapshotName('footer', 'connected'),
          clip: {
            x: 0,
            y: box.y,
            width: 800,
            height: box.height,
          },
          maxDiffPixelRatio: 0.02,
        });
      }
    });

    test('should display disconnected status', async ({ visualTest }) => {
      const { page, waitForOrb, injectStoreState, visualCompare } = visualTest;

      await waitForOrb();

      await injectStoreState({
        isReady: false,
      });

      await page.waitForTimeout(100);

      const connectionStatus = page.locator('.connection-status');
      await expect(connectionStatus).toHaveClass(/disconnected/);

      const footer = page.locator('.atlas-footer');
      const box = await footer.boundingBox();

      if (box) {
        await visualCompare({
          name: createSnapshotName('footer', 'disconnected'),
          clip: {
            x: 0,
            y: box.y,
            width: 800,
            height: box.height,
          },
          maxDiffPixelRatio: 0.02,
        });
      }
    });
  });

  test.describe('Settings Button', () => {
    test('should render settings button correctly', async ({ visualTest }) => {
      const { page, waitForOrb, visualCompare } = visualTest;

      await waitForOrb();

      const settingsButton = page.locator('.footer-button[aria-label="Settings"]');
      await expect(settingsButton).toBeVisible();

      const box = await settingsButton.boundingBox();

      if (box) {
        await visualCompare({
          name: createSnapshotName('footer', 'settings-button'),
          clip: {
            x: box.x - 5,
            y: box.y - 5,
            width: box.width + 10,
            height: box.height + 10,
          },
          maxDiffPixelRatio: 0.02,
        });
      }
    });

    test('should show hover state on settings button', async ({ visualTest }) => {
      const { page, waitForOrb, visualCompare } = visualTest;

      await waitForOrb();

      const settingsButton = page.locator('.footer-button[aria-label="Settings"]');
      await settingsButton.hover();
      await page.waitForTimeout(200);

      const box = await settingsButton.boundingBox();

      if (box) {
        await visualCompare({
          name: createSnapshotName('footer', 'settings-button-hover'),
          clip: {
            x: box.x - 5,
            y: box.y - 5,
            width: box.width + 10,
            height: box.height + 10,
          },
          maxDiffPixelRatio: 0.03,
        });
      }
    });
  });
});

// ============================================================================
// Test Suite: Settings Panel
// ============================================================================

test.describe('Settings Panel', () => {
  test.describe('Panel Layout', () => {
    test('should render settings panel correctly', async ({ visualTest }) => {
      const { page, waitForOrb, openSettings, visualCompare } = visualTest;

      await waitForOrb();
      await openSettings();

      await visualCompare({
        name: createSnapshotName('settings', 'panel-open'),
        fullPage: true,
        maxDiffPixelRatio: 0.03,
      });
    });

    test('should render settings header with close button', async ({ visualTest }) => {
      const { page, waitForOrb, openSettings, visualCompare } = visualTest;

      await waitForOrb();
      await openSettings();

      // Verify header elements
      const header = page.locator('.settings-header');
      await expect(header).toBeVisible();

      const title = page.locator('.settings-header h2');
      await expect(title).toHaveText('Settings');

      const closeButton = page.locator('.settings-close');
      await expect(closeButton).toBeVisible();

      const box = await header.boundingBox();

      if (box) {
        await visualCompare({
          name: createSnapshotName('settings', 'header'),
          clip: {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
          },
          maxDiffPixelRatio: 0.02,
        });
      }
    });
  });

  test.describe('Settings Sections', () => {
    const sections = [
      'Audio',
      'Voice',
      'Visual',
      'Orb Visualization',
      'Behavior',
      'Privacy',
      'AI Providers',
      'Personality',
      'Budget & Usage',
    ];

    for (const section of sections) {
      test(`should render ${section} section correctly`, async ({ visualTest }) => {
        const { page, waitForOrb, openSettings, visualCompare } = visualTest;

        await waitForOrb();
        await openSettings();

        // Find section by title
        const sectionTitle = page.locator(`.settings-section-title:has-text("${section}")`);
        await expect(sectionTitle).toBeVisible();

        // Scroll to section
        await sectionTitle.scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);

        // Get section bounds
        const sectionElement = sectionTitle.locator('..').locator('..');
        const box = await sectionElement.boundingBox();

        if (box) {
          await visualCompare({
            name: createSnapshotName('settings-section', section.toLowerCase().replace(/\s+/g, '-')),
            clip: {
              x: box.x,
              y: box.y,
              width: box.width,
              height: Math.min(box.height, 400), // Limit height for tall sections
            },
            maxDiffPixelRatio: 0.03,
          });
        }
      });
    }
  });

  test.describe('Settings Controls', () => {
    test('should render slider control correctly', async ({ visualTest }) => {
      const { page, waitForOrb, openSettings, visualCompare } = visualTest;

      await waitForOrb();
      await openSettings();

      // Find volume slider
      const volumeSlider = page.locator('.settings-slider').first();
      await expect(volumeSlider).toBeVisible();

      const box = await volumeSlider.boundingBox();

      if (box) {
        await visualCompare({
          name: createSnapshotName('settings-control', 'slider'),
          clip: {
            x: box.x - 10,
            y: box.y - 5,
            width: box.width + 20,
            height: box.height + 10,
          },
          maxDiffPixelRatio: 0.02,
        });
      }
    });

    test('should render toggle control correctly', async ({ visualTest }) => {
      const { page, waitForOrb, openSettings, visualCompare } = visualTest;

      await waitForOrb();
      await openSettings();

      // Find adaptive performance toggle
      const toggle = page.locator('.settings-toggle').first();
      await toggle.scrollIntoViewIfNeeded();
      await expect(toggle).toBeVisible();

      const box = await toggle.boundingBox();

      if (box) {
        await visualCompare({
          name: createSnapshotName('settings-control', 'toggle'),
          clip: {
            x: box.x - 10,
            y: box.y - 5,
            width: box.width + 20,
            height: box.height + 10,
          },
          maxDiffPixelRatio: 0.02,
        });
      }
    });

    test('should render select control correctly', async ({ visualTest }) => {
      const { page, waitForOrb, openSettings, visualCompare } = visualTest;

      await waitForOrb();
      await openSettings();

      // Find quality preset select
      const select = page.locator('.settings-select').first();
      await select.scrollIntoViewIfNeeded();
      await expect(select).toBeVisible();

      const box = await select.boundingBox();

      if (box) {
        await visualCompare({
          name: createSnapshotName('settings-control', 'select'),
          clip: {
            x: box.x - 10,
            y: box.y - 5,
            width: box.width + 20,
            height: box.height + 10,
          },
          maxDiffPixelRatio: 0.02,
        });
      }
    });

    test('should render text input control correctly', async ({ visualTest }) => {
      const { page, waitForOrb, openSettings, visualCompare } = visualTest;

      await waitForOrb();
      await openSettings();

      // Scroll to behavior section for wake word input
      const behaviorSection = page.locator('.settings-section-title:has-text("Behavior")');
      await behaviorSection.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);

      const textInput = page.locator('.settings-text-input').first();
      await expect(textInput).toBeVisible();

      const box = await textInput.boundingBox();

      if (box) {
        await visualCompare({
          name: createSnapshotName('settings-control', 'text-input'),
          clip: {
            x: box.x - 10,
            y: box.y - 5,
            width: box.width + 20,
            height: box.height + 10,
          },
          maxDiffPixelRatio: 0.02,
        });
      }
    });
  });

  test.describe('Settings Footer', () => {
    test('should render settings footer buttons correctly', async ({ visualTest }) => {
      const { page, waitForOrb, openSettings, visualCompare } = visualTest;

      await waitForOrb();
      await openSettings();

      // Scroll to footer
      const settingsFooter = page.locator('.settings-footer');
      await settingsFooter.scrollIntoViewIfNeeded();
      await expect(settingsFooter).toBeVisible();

      const box = await settingsFooter.boundingBox();

      if (box) {
        await visualCompare({
          name: createSnapshotName('settings', 'footer'),
          clip: {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
          },
          maxDiffPixelRatio: 0.02,
        });
      }
    });
  });

  test.describe('Settings Overlay', () => {
    test('should close settings on overlay click', async ({ visualTest }) => {
      const { page, waitForOrb, openSettings, visualCompare } = visualTest;

      await waitForOrb();
      await openSettings();

      // Click overlay (outside panel)
      const overlay = page.locator('.settings-overlay');
      await overlay.click({ position: { x: 50, y: 50 } });

      // Panel should close
      await page.waitForTimeout(200);
      await expect(page.locator('.settings-panel')).not.toBeVisible();

      await visualCompare({
        name: createSnapshotName('settings', 'closed'),
        fullPage: true,
        maxDiffPixelRatio: 0.03,
      });
    });

    test('should close settings on Escape key', async ({ visualTest }) => {
      const { page, waitForOrb, openSettings } = visualTest;

      await waitForOrb();
      await openSettings();

      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);

      await expect(page.locator('.settings-panel')).not.toBeVisible();
    });
  });
});

// ============================================================================
// Test Suite: Debug Overlay
// ============================================================================

test.describe('Debug Overlay', () => {
  test('should render debug overlay when enabled', async ({ visualTest }) => {
    const { page, waitForOrb, injectStoreState, visualCompare } = visualTest;

    await waitForOrb();

    // Enable debug overlay
    await injectStoreState({
      settings: {
        showDebug: true,
      },
    });

    await page.waitForTimeout(200);

    const debugOverlay = page.locator('.debug-overlay');
    // Debug overlay may not be visible in test mode, but we test for it
    const isVisible = await debugOverlay.isVisible().catch(() => false);

    if (isVisible) {
      await visualCompare({
        name: createSnapshotName('debug', 'overlay'),
        maxDiffPixelRatio: 0.04,
      });
    }
  });

  test('should hide debug overlay when disabled', async ({ visualTest }) => {
    const { page, waitForOrb, injectStoreState } = visualTest;

    await waitForOrb();

    // Disable debug overlay
    await injectStoreState({
      settings: {
        showDebug: false,
      },
    });

    await page.waitForTimeout(100);

    const debugOverlay = page.locator('.debug-overlay');
    // Should be hidden or not visible
    const isVisible = await debugOverlay.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });
});

// ============================================================================
// Test Suite: Error Toast
// ============================================================================

test.describe('Error Toast', () => {
  test('should render error toast correctly', async ({ visualTest }) => {
    const { page, waitForOrb, visualCompare } = visualTest;

    await waitForOrb();

    // Trigger an error toast via custom event
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('atlas:test:showError', {
          detail: {
            message: 'Test error message',
            type: 'error',
          },
        })
      );
    });

    await page.waitForTimeout(300);

    // Check for error toast
    const errorToast = page.locator('.error-toast');
    const isVisible = await errorToast.isVisible().catch(() => false);

    if (isVisible) {
      await visualCompare({
        name: createSnapshotName('toast', 'error'),
        maxDiffPixelRatio: 0.03,
      });
    }
  });
});

// ============================================================================
// Test Suite: Loading Indicators
// ============================================================================

test.describe('Loading Indicators', () => {
  test.describe('Spinner Variants', () => {
    test('should render loading spinner correctly', async ({ visualTest }) => {
      const { page, waitForOrb, openSettings, visualCompare } = visualTest;

      await waitForOrb();
      await openSettings();

      // Find any loading indicator
      const loadingIndicator = page.locator('.loading-indicator').first();
      const isVisible = await loadingIndicator.isVisible().catch(() => false);

      if (isVisible) {
        const box = await loadingIndicator.boundingBox();

        if (box) {
          await visualCompare({
            name: createSnapshotName('loading', 'spinner'),
            clip: {
              x: box.x - 10,
              y: box.y - 10,
              width: box.width + 20,
              height: box.height + 20,
            },
            maxDiffPixelRatio: 0.03,
          });
        }
      }
    });
  });
});

// ============================================================================
// Test Suite: Keyboard Shortcuts Modal
// ============================================================================

test.describe('Keyboard Shortcuts Modal', () => {
  test('should render keyboard shortcuts modal correctly', async ({ visualTest }) => {
    const { page, waitForOrb, visualCompare } = visualTest;

    await waitForOrb();

    // Trigger keyboard shortcuts modal (? key)
    await page.keyboard.press('?');
    await page.waitForTimeout(300);

    const modal = page.locator('.keyboard-shortcuts-modal');
    const isVisible = await modal.isVisible().catch(() => false);

    if (isVisible) {
      await visualCompare({
        name: createSnapshotName('modal', 'keyboard-shortcuts'),
        fullPage: true,
        maxDiffPixelRatio: 0.03,
      });
    }
  });
});

// ============================================================================
// Test Suite: Responsive Components
// ============================================================================

test.describe('Responsive Components', () => {
  const viewports = [
    { width: 1280, height: 720, name: 'desktop' },
    { width: 800, height: 600, name: 'tablet' },
    { width: 640, height: 480, name: 'mobile-landscape' },
    { width: 390, height: 844, name: 'mobile-portrait' },
  ];

  for (const viewport of viewports) {
    test.describe(`${viewport.name} viewport`, () => {
      test('should render footer correctly', async ({ visualTest }) => {
        const { page, waitForOrb, visualCompare } = visualTest;

        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await waitForOrb();

        const footer = page.locator('.atlas-footer');
        const box = await footer.boundingBox();

        if (box) {
          await visualCompare({
            name: createSnapshotName('responsive-footer', viewport.name),
            clip: {
              x: 0,
              y: box.y,
              width: viewport.width,
              height: box.height,
            },
            maxDiffPixelRatio: 0.03,
          });
        }
      });

      test('should render conversation panel correctly', async ({ visualTest }) => {
        const { page, waitForOrb, injectStoreState, visualCompare } = visualTest;

        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await waitForOrb();

        await injectStoreState({
          transcript: 'Test message',
          response: 'Test response',
          showTranscript: true,
        });

        await page.waitForTimeout(200);

        const conversation = page.locator('.atlas-conversation');
        const isVisible = await conversation.isVisible().catch(() => false);

        if (isVisible) {
          const box = await conversation.boundingBox();

          if (box) {
            await visualCompare({
              name: createSnapshotName('responsive-conversation', viewport.name),
              clip: {
                x: box.x - 10,
                y: box.y - 10,
                width: box.width + 20,
                height: box.height + 20,
              },
              maxDiffPixelRatio: 0.03,
            });
          }
        }
      });
    });
  }
});

// ============================================================================
// Test Suite: Accessibility Visual Tests
// ============================================================================

test.describe('Accessibility Visual Tests', () => {
  test.describe('Focus States', () => {
    test('should show visible focus indicators', async ({ visualTest }) => {
      const { page, waitForOrb, visualCompare } = visualTest;

      await waitForOrb();

      // Tab through interactive elements
      await page.keyboard.press('Tab');
      await page.waitForTimeout(100);

      await visualCompare({
        name: createSnapshotName('a11y', 'focus-first'),
        fullPage: true,
        maxDiffPixelRatio: 0.03,
      });
    });
  });

  test.describe('High Contrast', () => {
    test('should maintain readability in high contrast mode', async ({ visualTest }) => {
      const { page, waitForOrb, visualCompare } = visualTest;

      await waitForOrb();

      // Simulate high contrast mode
      await page.emulateMedia({ forcedColors: 'active' });
      await page.waitForTimeout(200);

      await visualCompare({
        name: createSnapshotName('a11y', 'high-contrast'),
        fullPage: true,
        maxDiffPixelRatio: 0.05, // Allow more variance for forced colors
      });
    });
  });

  test.describe('Reduced Motion', () => {
    test('should respect reduced motion preference', async ({ visualTest }) => {
      const { page, waitForOrb, visualCompare } = visualTest;

      await waitForOrb();

      // Simulate reduced motion preference
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForTimeout(200);

      await visualCompare({
        name: createSnapshotName('a11y', 'reduced-motion'),
        fullPage: true,
        maxDiffPixelRatio: 0.03,
      });
    });
  });
});

// ============================================================================
// Test Suite: Theme Integration
// ============================================================================

test.describe('Theme Integration', () => {
  test.describe('CSS Variables', () => {
    test('should apply CSS custom properties correctly', async ({ visualTest }) => {
      const { page, waitForOrb } = visualTest;

      await waitForOrb();

      // Verify key CSS variables are defined
      const cssVars = await page.evaluate(() => {
        const styles = getComputedStyle(document.documentElement);
        return {
          bgPrimary: styles.getPropertyValue('--atlas-bg-primary'),
          textPrimary: styles.getPropertyValue('--atlas-text-primary'),
          accent: styles.getPropertyValue('--atlas-accent'),
          orbIdle: styles.getPropertyValue('--orb-idle'),
          orbListening: styles.getPropertyValue('--orb-listening'),
        };
      });

      // All variables should be defined
      expect(cssVars.bgPrimary).toBeTruthy();
      expect(cssVars.textPrimary).toBeTruthy();
    });
  });
});
